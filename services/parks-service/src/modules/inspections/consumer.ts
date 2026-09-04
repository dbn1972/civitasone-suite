import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as complaintsRepo from "../complaints/repo.js";
import * as treeRequestsRepo from "../tree_requests/repo.js";

const log = pino({ name: "parks.inspections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerInspectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.SCHEDULE_INSPECTION, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // BUG FIX (orphan inspection rows): defense-in-depth mirror of the
      // route-level check in inspections/routes.ts. The route already
      // rejects a nonexistent complaintId/treeRequestId before publishing,
      // so this should never actually fire in the normal HTTP path — but
      // the consumer must not blindly trust its own queue payload (a
      // directly-published or replayed command bypasses the route
      // entirely), and this is the layer that actually decides whether the
      // row gets written. Re-checked tenant-scoped, same as the route.
      if (p.complaintId) {
        const complaint = await complaintsRepo.findByIdTx(tx, p.complaintId, msg.tenantId);
        if (!complaint) {
          log.warn({ id: p.id, complaintId: p.complaintId }, "SCHEDULE_INSPECTION: referenced complaint not found — dropping, not inserting an orphan row");
          return;
        }
      }
      if (p.treeRequestId) {
        const treeRequest = await treeRequestsRepo.findByIdTx(tx, p.treeRequestId, msg.tenantId);
        if (!treeRequest) {
          log.warn({ id: p.id, treeRequestId: p.treeRequestId }, "SCHEDULE_INSPECTION: referenced tree request not found — dropping, not inserting an orphan row");
          return;
        }
      }
      if (!p.complaintId && !p.treeRequestId) {
        log.warn({ id: p.id }, "SCHEDULE_INSPECTION: neither complaintId nor treeRequestId supplied — dropping, not inserting an orphan row");
        return;
      }
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintId: p.complaintId,
        treeRequestId: p.treeRequestId, inspectorId: p.inspectorId,
        scheduledDate: p.scheduledDate, status: "scheduled",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.INSPECTION_SCHEDULED, eventType: EVENTS.INSPECTION_SCHEDULED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { inspectionId: p.id, complaintId: p.complaintId, treeRequestId: p.treeRequestId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.create", resourceType: "parks_inspection", resourceId: p.id });
      applied = true;
    });
    // Only logs 'inspection created' when a row was actually inserted —
    // previously this sat outside the transaction unconditionally, so a
    // dropped orphan-reference message (see the checks above) still logged
    // a misleading success message despite writing nothing. Matches the
    // `applied` guard pattern already used by every other handler in this
    // file (COMPLETE_INSPECTION) and by the sibling modules' consumers.
    if (applied) log.info({ id: p.id }, "inspection created");
  });

  queue.subscribe(COMMANDS.COMPLETE_INSPECTION, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, {
        status: "completed", inspectedAt: new Date(), findings: p.findings,
        photos: p.photos, workOrderRequired: p.workOrderRequired,
        updatedBy: msg.actorId,
      }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.INSPECTION_COMPLETED, eventType: EVENTS.INSPECTION_COMPLETED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { inspectionId: p.id, workOrderRequired: p.workOrderRequired },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.complete", resourceType: "parks_inspection", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "inspection completed");
  });
}
