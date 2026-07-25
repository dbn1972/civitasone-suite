import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as poRepo from "./repo.js";
import * as amendRepo from "./amendment-repo.js";
import {
  assertPoAmendable, assertAmendmentTransition, assertMilestoneTransition,
  assertDistinctMakerChecker, assertClosable, computeChangeOrder, nextSeq,
} from "./amendment-domain.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";

export function registerPoAmendmentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.poAmendmentRequest, async (msg) => {
    const p = msg.payload as {
      id: string; poId: string; tenantId: string; amendmentType: string;
      reason: string; deltaMinor: number; effectiveDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const po = await poRepo.findPoByIdTx(tx, p.poId, p.tenantId);
      if (!po) throw new Error(`PO ${p.poId} not found`);
      assertPoAmendable(po.status);
      const { deltaMinor, prevTotalMinor, newTotalMinor } = computeChangeOrder(BigInt(po.totalMinor), BigInt(p.deltaMinor));
      const amendmentNo = nextSeq(await amendRepo.maxAmendmentNoTx(tx, p.poId, p.tenantId));
      await amendRepo.insertAmendment(tx, {
        id: p.id, poId: p.poId, tenantId: p.tenantId, amendmentNo,
        amendmentType: p.amendmentType, status: "pending", reason: p.reason,
        deltaMinor, prevTotalMinor, newTotalMinor, currency: po.currency,
        effectiveDate: p.effectiveDate ?? null, requestedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // Maker-checker workflow task for a checker to approve the amendment.
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: randomUUID(), tenantId: msg.tenantId,
          name: `PO Amendment #${amendmentNo} Approval — ${po.poNo}`,
          status: "active", definitionCode: "procurement_po_amendment_approval",
          initialTaskName: "Amendment Approval", version: 1,
          refType: "procurement_po_amendment", refId: p.id,
        },
      });
      await audit(tx, msg, "request", "procurement_po_amendment", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.poId));
  });

  queue.subscribe(COMMANDS.poAmendmentApprove, async (msg) => {
    const p = msg.payload as { poId: string; amendmentId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const amendment = await amendRepo.findAmendmentByIdTx(tx, p.amendmentId, p.tenantId);
      if (!amendment || amendment.poId !== p.poId) throw new Error(`amendment ${p.amendmentId} not found`);
      // Maker-checker defense-in-depth.
      assertDistinctMakerChecker(amendment.requestedBy, msg.actorId);
      assertAmendmentTransition(amendment.status, "approved");
      // Re-read the PO under a FOR UPDATE row lock so concurrent amendment
      // approvals serialise on this row — we never write a request-time snapshot.
      const po = await poRepo.lockPoByIdTx(tx, p.poId, p.tenantId);
      if (!po) throw new Error(`PO ${p.poId} not found`);
      // STALENESS GUARD (SVC-046 lost-update fix): if the PO total moved since
      // this amendment was requested, another amendment was applied in between
      // and this amendment's snapshot (prev/newTotalMinor) is stale. Blindly
      // writing it would silently erase the interleaved delta (a lost update:
      // 1000 -> A(+100)=1100, then approving a stale B snapshot of 1050 loses A).
      // Semantics chosen: REJECT-STALE — supersede this amendment as rejected
      // with a clear reason so it must be re-raised against the current total.
      // We never silently mutate a financial total from a stale base.
      if (BigInt(amendment.prevTotalMinor) !== BigInt(po.totalMinor)) {
        await amendRepo.updateAmendment(tx, p.amendmentId, {
          status: "rejected",
          rejectedReason: `AMENDMENT_STALE_BASE: PO total changed from ${amendment.prevTotalMinor} to ${po.totalMinor} since this amendment was requested; re-raise against the current total`,
          updatedBy: msg.actorId, version: (amendment.version ?? 1) + 1,
        });
        await audit(tx, msg, "reject_stale", "procurement_po_amendment", p.amendmentId);
        return;
      }
      await amendRepo.updateAmendment(tx, p.amendmentId, {
        status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
        updatedBy: msg.actorId, version: (amendment.version ?? 1) + 1,
      });
      // Recompute the new total from the freshly-locked current value (defence
      // in depth — equals the snapshot on the non-stale path) and write it via
      // the optimistic-locked update keyed on the locked version.
      const newTotalMinor = BigInt(po.totalMinor) + BigInt(amendment.deltaMinor);
      await poRepo.updatePoVersioned(tx, p.poId, po.version ?? 1, {
        totalMinor: newTotalMinor, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.poAmended, eventType: EVENTS.poAmended,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          poId: p.poId, tenantId: p.tenantId, amendmentId: p.amendmentId,
          amendmentNo: amendment.amendmentNo, amendmentType: amendment.amendmentType,
          deltaMinor: amendment.deltaMinor.toString(), newTotalMinor: newTotalMinor.toString(),
        },
      });
      await audit(tx, msg, "approve", "procurement_po_amendment", p.amendmentId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.poId));
  });

  queue.subscribe(COMMANDS.poAmendmentReject, async (msg) => {
    const p = msg.payload as { poId: string; amendmentId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const amendment = await amendRepo.findAmendmentByIdTx(tx, p.amendmentId, p.tenantId);
      if (!amendment || amendment.poId !== p.poId) throw new Error(`amendment ${p.amendmentId} not found`);
      assertAmendmentTransition(amendment.status, "rejected");
      await amendRepo.updateAmendment(tx, p.amendmentId, {
        status: "rejected", rejectedReason: p.reason,
        updatedBy: msg.actorId, version: (amendment.version ?? 1) + 1,
      });
      await audit(tx, msg, "reject", "procurement_po_amendment", p.amendmentId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.poId));
  });

  queue.subscribe(COMMANDS.poMilestoneAdd, async (msg) => {
    const p = msg.payload as {
      id: string; poId: string; tenantId: string; title: string;
      description?: string; dueDate?: string; amountMinor: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const po = await poRepo.findPoByIdTx(tx, p.poId, p.tenantId);
      if (!po) throw new Error(`PO ${p.poId} not found`);
      const milestoneNo = nextSeq(await amendRepo.maxMilestoneNoTx(tx, p.poId, p.tenantId));
      await amendRepo.insertMilestone(tx, {
        id: p.id, poId: p.poId, tenantId: p.tenantId, milestoneNo,
        title: p.title, description: p.description ?? null, dueDate: p.dueDate ?? null,
        amountMinor: BigInt(p.amountMinor), currency: po.currency, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "procurement_po_milestone", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.poId));
  });

  queue.subscribe(COMMANDS.poMilestoneUpdate, async (msg) => {
    const p = msg.payload as { poId: string; milestoneId: string; tenantId: string; status: string; deliveredQty?: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ms = await amendRepo.findMilestoneByIdTx(tx, p.milestoneId, p.tenantId);
      if (!ms || ms.poId !== p.poId) throw new Error(`milestone ${p.milestoneId} not found`);
      assertMilestoneTransition(ms.status, p.status as any);
      const terminal = p.status === "delivered" || p.status === "closed";
      await amendRepo.updateMilestone(tx, p.milestoneId, {
        status: p.status,
        deliveredQty: p.deliveredQty ?? ms.deliveredQty,
        completedAt: terminal ? new Date() : ms.completedAt,
        updatedBy: msg.actorId, version: (ms.version ?? 1) + 1,
      });
      await audit(tx, msg, "update", "procurement_po_milestone", p.milestoneId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.poId));
  });

  queue.subscribe(COMMANDS.poClose, async (msg) => {
    const p = msg.payload as { poId: string; tenantId: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const po = await poRepo.findPoByIdTx(tx, p.poId, p.tenantId);
      if (!po) throw new Error(`PO ${p.poId} not found`);
      const milestones = await amendRepo.listMilestonesByPoTx(tx, p.poId, p.tenantId);
      assertClosable(po.status, milestones.map((m) => m.status));
      await poRepo.updatePo(tx, p.poId, { status: "closed", updatedBy: msg.actorId, version: (po.version ?? 1) + 1 });
      await enqueue(tx, {
        topic: EVENTS.poClosed, eventType: EVENTS.poClosed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { poId: p.poId, tenantId: p.tenantId, poNo: po.poNo, orderType: po.orderType },
      });
      await audit(tx, msg, "close", "procurement_po", p.poId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.poId));
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
