import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { orders } from "../order/schema.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";
import { assertTransition, assertDifferentApprover } from "./domain.js";

type SubmitForApprovalPayload = {
  orderId: string;
  tenantId: string;
  expectedVersion: number;
};

type ApproveAndIssuePayload = {
  orderId: string;
  tenantId: string;
  dscSignature: string;
  issuedDate?: string; // YYYY-MM-DD
  expectedVersion: number;
};

type SendBackPayload = {
  orderId: string;
  tenantId: string;
  remarks?: string;
  expectedVersion: number;
};

type RecallPayload = {
  orderId: string;
  tenantId: string;
  recallReason: string;
  expectedVersion: number;
};

/**
 * order-issuance consumer — the maker-checker approval + DSC-pronouncement state
 * machine, enforced (§23 + §35.5 "AI never auto-issues").
 *
 * Every handler is ONE tenant-scoped tx: markProcessed dedupe → read current
 * (status, version, maker) → NonRetryable ORDER_NOT_FOUND if missing → no-op if
 * already at the target status (redelivery-safe) → reject a stale optimistic-lock
 * token (NonRetryable VERSION_CONFLICT) → reject an illegal transition
 * (NonRetryable INVALID_ISSUANCE_TRANSITION) → version-guarded write → emit the
 * domain event → audit, all together.
 *
 * Not-found / version-conflict / illegal-transition / maker-checker violations are
 * NonRetryableError so they dead-letter for investigation instead of retrying
 * forever (retrying cannot fix a stale version, an illegal edge, or a self-approval).
 */
export function registerOrderIssuanceConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Submit for approval (draft → pending_approval).
  register<SubmitForApprovalPayload>(COMMANDS.submitOrderForApproval, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      const current = await repo.getOrderForIssuance(tx, p.tenantId, p.orderId);
      if (!current) throw new NonRetryableError(`ORDER_NOT_FOUND: ${p.orderId}`);
      if (current.status === "pending_approval") return; // already submitted; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: order ${p.orderId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, "pending_approval");
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, orders, {
        id: p.orderId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: "pending_approval",
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "order",
      });

      await enqueue(tx, {
        topic: EVENTS.orderPendingApproval,
        eventType: EVENTS.orderPendingApproval,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { orderId: p.orderId, status: "pending_approval" },
      });
      await audit(tx, msg, "submit_for_approval", "court_order", p.orderId);
      await cache.invalidateAfterCommit(tx, cache.makeKey(msg.tenantId, "order", p.orderId));
    });
  });

  // Approve + issue (pending_approval → issued).
  //
  // ─────────────────────────────────────────────────────────────────────────────
  // §35.5 — ISSUANCE IS A HUMAN, DSC-SIGNED ACT. An AI / service actor must NEVER
  // call this handler. The maker-checker rule below is the integrity crux: the
  // approver/issuer (msg.actorId) MUST be a different person from the order's maker
  // (createdBy, falling back to signedBy). A self-approval is a MAKER_CHECKER_VIOLATION
  // and is rejected (NonRetryable) BEFORE any write — the order is never issued.
  // ─────────────────────────────────────────────────────────────────────────────
  register<ApproveAndIssuePayload>(COMMANDS.approveAndIssueOrder, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      const current = await repo.getOrderForIssuance(tx, p.tenantId, p.orderId);
      if (!current) throw new NonRetryableError(`ORDER_NOT_FOUND: ${p.orderId}`);
      if (current.status === "issued") return; // already issued; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: order ${p.orderId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }

      // MAKER-CHECKER — enforced BEFORE the versionedUpdate so a self-approval can
      // never mutate the row. createdBy is the maker (the officer who recorded the
      // draft); signedBy is the fallback maker identity.
      try {
        assertDifferentApprover(current.createdBy ?? current.signedBy, msg.actorId);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      try {
        assertTransition(current.status, "issued");
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, orders, {
        id: p.orderId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: "issued",
          approvedBy: msg.actorId,
          issuedAt: new Date(),
          dscSignature: p.dscSignature,
          // Only override the pronouncement date when explicitly supplied; otherwise
          // leave the existing order_date untouched (p.issuedDate ?? existing).
          ...(p.issuedDate ? { orderDate: p.issuedDate } : {}),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "order",
      });

      await enqueue(tx, {
        topic: EVENTS.orderIssued,
        eventType: EVENTS.orderIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { orderId: p.orderId, approvedBy: msg.actorId, issuedDate: p.issuedDate ?? null },
      });
      await audit(tx, msg, "approve_and_issue", "court_order", p.orderId);
      await cache.invalidateAfterCommit(tx, cache.makeKey(msg.tenantId, "order", p.orderId));
    });
  });

  // Send back for revision (pending_approval → draft).
  register<SendBackPayload>(COMMANDS.sendBackOrder, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      const current = await repo.getOrderForIssuance(tx, p.tenantId, p.orderId);
      if (!current) throw new NonRetryableError(`ORDER_NOT_FOUND: ${p.orderId}`);
      if (current.status === "draft") return; // already back with the maker; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: order ${p.orderId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, "draft");
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, orders, {
        id: p.orderId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: "draft",
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "order",
      });

      await enqueue(tx, {
        topic: EVENTS.orderSentBack,
        eventType: EVENTS.orderSentBack,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { orderId: p.orderId, status: "draft", remarks: p.remarks ?? null },
      });
      await audit(tx, msg, "send_back", "court_order", p.orderId);
      await cache.invalidateAfterCommit(tx, cache.makeKey(msg.tenantId, "order", p.orderId));
    });
  });

  // Recall an issued order (issued → recalled).
  register<RecallPayload>(COMMANDS.recallOrder, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      const current = await repo.getOrderForIssuance(tx, p.tenantId, p.orderId);
      if (!current) throw new NonRetryableError(`ORDER_NOT_FOUND: ${p.orderId}`);
      if (current.status === "recalled") return; // already recalled; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: order ${p.orderId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, "recalled");
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, orders, {
        id: p.orderId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: "recalled",
          recallReason: p.recallReason,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "order",
      });

      await enqueue(tx, {
        topic: EVENTS.orderRecalled,
        eventType: EVENTS.orderRecalled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { orderId: p.orderId, recallReason: p.recallReason },
      });
      await audit(tx, msg, "recall", "court_order", p.orderId);
      await cache.invalidateAfterCommit(tx, cache.makeKey(msg.tenantId, "order", p.orderId));
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
