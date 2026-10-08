import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "asset-verification-consumer" });
const AUDIT = "audit.event.record";

function audit(
  actorId: string, tenantId: string, correlationId: string,
  action: string, resourceType: string, resourceId: string, outcome: "success" | "failure" = "success",
) {
  return {
    topic: AUDIT, eventType: AUDIT, tenantId, actorId, correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome },
  };
}

export function registerVerificationConsumers(rawQueue: Queue): void {
  // Run every handler inside the message tenant context so NOBYPASSRLS +
  // FORCE RLS accepts the writes (the #146 pattern every other asset consumer
  // already uses). Without it every verification create/item/approve was
  // rejected by RLS in the consumer and silently never persisted.
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.verificationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; verificationDate: string; notes?: string | null; location?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertVerification(tx, {
          id: p.id, tenantId: p.tenantId, verificationDate: p.verificationDate,
          verifiedBy: msg.actorId, status: "draft", notes: p.notes ?? null, location: p.location ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_create", "verification", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verificationItemAdd, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; verificationId: string; assetId: string;
      condition: string; foundAtLocation?: boolean; remarks?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Race guard: lock the session and require it to still be a draft.
        if (!(await repo.lockDraftSession(tx, p.verificationId, p.tenantId))) {
          await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_item_add_rejected", "verification_item", p.id, "failure"));
          log.warn({ messageId: msg.messageId, verificationId: p.verificationId }, "verificationItemAdd skipped: session is not a draft");
          return;
        }
        await repo.insertVerificationItem(tx, {
          id: p.id, verificationId: p.verificationId, tenantId: p.tenantId, assetId: p.assetId,
          condition: p.condition, foundAtLocation: p.foundAtLocation ?? true,
          remarks: p.remarks ?? null,
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_item_add", "verification_item", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationItemAdd failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verificationSubmit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        if (!(await repo.transitionVerification(tx, p.id, p.tenantId, "draft", { status: "submitted" }))) {
          await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_submit_rejected", "verification", p.id, "failure"));
          log.warn({ messageId: msg.messageId, id: p.id }, "verificationSubmit skipped: session is not a draft");
          return;
        }
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_submit", "verification", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationSubmit failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verificationApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // GAP2-ASSETS-VERIFICATION-01: re-assert segregation of duties inside the
        // write tx. The route already blocks self-approval; this stops a command
        // that raced past (or bypassed) the preflight from ever persisting.
        const session = await repo.findVerificationByIdTx(tx, p.id, p.tenantId);
        if (session && session.createdBy === msg.actorId) {
          await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_approve_rejected", "verification", p.id, "failure"));
          log.warn({ messageId: msg.messageId, id: p.id }, "verificationApprove refused: self-approval (SoD)");
          return;
        }
        if (!(await repo.transitionVerification(tx, p.id, p.tenantId, "submitted", {
          status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
        }))) {
          await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_approve_rejected", "verification", p.id, "failure"));
          log.warn({ messageId: msg.messageId, id: p.id }, "verificationApprove skipped: session is not submitted");
          return;
        }
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_approve", "verification", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationApprove failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.writeoffRequest, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; assetId: string; remarks?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertWriteoffRequest(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId, requestedBy: msg.actorId,
          status: "pending", committeeRemarks: p.remarks ?? null,
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "writeoff_request", "writeoff", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "writeoffRequest failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.writeoffApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      // SoD is enforced at the route boundary before publish.
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.approveWriteoff(tx, p.id, p.tenantId, msg.actorId);
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "writeoff_approve", "writeoff", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "writeoffApprove failed");
      throw err;
    }
  });
}
