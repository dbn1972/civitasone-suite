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

  // ── R4 record-room management ───────────────────────────────────────────

  queue.subscribe(COMMANDS.transferToRecordRoom, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; recordRoomId?: string; rack?: string; shelf?: string; bundleNo?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rec = await repo.findRecordTx(tx, p.tenantId, p.fileId);
      if (!rec) return; // no record row → file not yet categorised
      await repo.transferToRecordRoom(tx, p.tenantId, p.fileId, {
        ...(p.recordRoomId ? { recordRoomId: p.recordRoomId } : {}),
        ...(p.rack ? { rack: p.rack } : {}),
        ...(p.shelf ? { shelf: p.shelf } : {}),
        ...(p.bundleNo ? { bundleNo: p.bundleNo } : {}),
      }, msg.actorId);
      await audit(tx, msg, "transfer_to_record_room", "file_record", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file_record", p.fileId));
  });

  queue.subscribe(COMMANDS.requisitionRecord, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; fileId: string; purpose: string | null; dueBack: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rec = await repo.findRecordTx(tx, p.tenantId, p.fileId);
      if (!rec || rec.roomStatus !== "in_record_room") return; // can only issue from record room
      await repo.insertRequisition(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        requestedBy: msg.actorId,
        ...(p.purpose ? { purpose: p.purpose } : {}),
        ...(p.dueBack ? { dueBack: p.dueBack } : {}),
        status: "issued", createdBy: msg.actorId,
      });
      await repo.markRecordIssued(tx, p.tenantId, p.fileId, msg.actorId);
      await audit(tx, msg, "requisition", "record_requisition", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file_record", p.fileId));
  });

  queue.subscribe(COMMANDS.returnRecord, async (msg) => {
    const p = msg.payload as { requisitionId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const req = await repo.findRequisitionByIdTx(tx, p.requisitionId, p.tenantId);
      if (!req || req.status !== "issued") return;
      await repo.updateRequisition(tx, p.requisitionId, { status: "returned", returnedAt: new Date() });
      await repo.markRecordReturned(tx, p.tenantId, req.fileId, msg.actorId);
      await audit(tx, msg, "return", "record_requisition", p.requisitionId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file_record", p.requisitionId));
  });

  // ── R5 archival & NAI transfer ──────────────────────────────────────────

  queue.subscribe(COMMANDS.archiveFile, async (msg) => {
    const p = msg.payload as { id: string; fileId: string; tenantId: string; remarks: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rec = await repo.findRecordTx(tx, p.tenantId, p.fileId);
      if (!rec) return; // must be categorised before archival
      // Cat-A → NAI-eligible at closed + 25 years.
      const naiEligibleAt = rec.recordCategory === "A"
        ? (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 25); return d; })()
        : null;
      const status = naiEligibleAt ? "nai_due" : "archived";
      await repo.insertArchival(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        archivedBy: msg.actorId, status,
        ...(naiEligibleAt ? { naiEligibleAt } : {}),
        ...(p.remarks ? { remarks: p.remarks } : {}),
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "archive", "archival", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "archival", p.fileId));
  });

  queue.subscribe(COMMANDS.recordNaiTransfer, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; naiReference: string; registerNo: string | null; remarks: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const arch = await repo.findArchivalByFile(p.tenantId, p.fileId);
      if (!arch || arch.status === "nai_transferred") return;
      await repo.updateArchival(tx, arch.id, {
        status: "nai_transferred", naiTransferredAt: new Date(),
        naiReference: p.naiReference,
        ...(p.registerNo ? { registerNo: p.registerNo } : {}),
        ...(p.remarks ? { remarks: p.remarks } : {}),
      });
      await audit(tx, msg, "nai_transfer", "archival", arch.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "archival", p.fileId));
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
