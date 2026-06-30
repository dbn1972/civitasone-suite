import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "./commands.js";
import {
  RETENTION_YEARS, computeReviewDueDate, assertWeedable, toDateString,
  assertValidCategory, DomainError, type RecordCategory,
} from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRecordsConsumers(queue: Queue): void {
  // ── Assign a CSMOP record category (derives retention + review-due) ────────
  queue.subscribe(COMMANDS.assignCategory, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; category: string; disposalAction?: string | null };
    assertValidCategory(p.category);
    const category = p.category as RecordCategory;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const from = new Date();
      const reviewDue = computeReviewDueDate(category, from);
      await repo.upsertRecord(tx, {
        tenantId: p.tenantId, fileId: p.fileId,
        recordCategory: category,
        retentionYears: RETENTION_YEARS[category],
        reviewDueDate: reviewDue ? toDateString(reviewDue) : null,
        ...(p.disposalAction ? { disposalAction: p.disposalAction } : {}),
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "assign_category", "file_record", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file_record", p.fileId));
  });

  // ── Record a disposal action against the file's record ─────────────────────
  queue.subscribe(COMMANDS.recordDisposal, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; disposalAction: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.recordDisposalTx(tx, p.tenantId, p.fileId, {
        disposalAction: p.disposalAction, disposedAt: new Date(), disposedBy: msg.actorId,
      });
      await audit(tx, msg, "record_disposal", "file_record", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file_record", p.fileId));
  });

  // ── Weed-out: propose ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.weedoutPropose, async (msg) => {
    const p = msg.payload as { id: string; fileId: string; tenantId: string; reason?: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertWeedout(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        status: "proposed", proposedBy: msg.actorId,
        reason: p.reason ?? null,
      });
      await audit(tx, msg, "propose", "weedout", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "weedout", p.id));
  });

  // ── Weed-out: approve (maker≠checker + assertWeedable gate) ────────────────
  queue.subscribe(COMMANDS.weedoutApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const wo = await repo.findWeedoutByIdTx(tx, p.id, p.tenantId);
      if (!wo || wo.status !== "proposed") {
        throw new DomainError("INVALID_STATE", `weed-out ${p.id} is not in 'proposed' state`);
      }
      // Maker≠checker: the approver MUST differ from the proposer. Checked
      // BEFORE the retention gate so a same-actor approval always surfaces as
      // MAKER_CHECKER_VIOLATION.
      if (wo.proposedBy === msg.actorId) {
        throw new DomainError(
          "MAKER_CHECKER_VIOLATION",
          "MAKER_CHECKER_VIOLATION: approver (reviewed_by) must differ from proposed_by",
        );
      }
      const record = await repo.findRecordTx(tx, p.tenantId, wo.fileId);
      const category = (record?.recordCategory ?? "A") as RecordCategory;
      const reviewDue = record?.reviewDueDate ? new Date(record.reviewDueDate) : null;
      assertWeedable(category, reviewDue, new Date());

      await repo.updateWeedout(tx, p.id, {
        status: "approved", reviewedBy: msg.actorId, reviewedAt: new Date(),
      });
      await audit(tx, msg, "approve", "weedout", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "weedout", p.id));
  });

  // ── Weed-out: reject ───────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.weedoutReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const wo = await repo.findWeedoutByIdTx(tx, p.id, p.tenantId);
      if (!wo || wo.status !== "proposed") {
        throw new DomainError("INVALID_STATE", `weed-out ${p.id} is not in 'proposed' state`);
      }
      await repo.updateWeedout(tx, p.id, {
        status: "rejected", reviewedBy: msg.actorId, reviewedAt: new Date(),
        ...(p.reason ? { reason: p.reason } : {}),
      });
      await audit(tx, msg, "reject", "weedout", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "weedout", p.id));
  });

  // ── Weed-out: destroy (only from 'approved') ───────────────────────────────
  queue.subscribe(COMMANDS.weedoutDestroy, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; destructionCertRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const wo = await repo.findWeedoutByIdTx(tx, p.id, p.tenantId);
      if (!wo || wo.status !== "approved") {
        throw new DomainError("INVALID_STATE", `weed-out ${p.id} must be 'approved' before destruction`);
      }
      await repo.updateWeedout(tx, p.id, {
        status: "destroyed", destructionCertRef: p.destructionCertRef, destroyedAt: new Date(),
      });
      await audit(tx, msg, "destroy", "weedout", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "weedout", p.id));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
