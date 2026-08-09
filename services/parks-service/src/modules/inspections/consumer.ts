import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "parks.inspections.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerInspectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.inspectionCreate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintId: p.complaintId,
        treeRequestId: p.treeRequestId, inspectorId: p.inspectorId,
        scheduledDate: p.scheduledDate, status: "scheduled",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.inspectionCreated, eventType: EVENTS.inspectionCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { inspectionId: p.id, complaintId: p.complaintId, treeRequestId: p.treeRequestId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.create", resourceType: "parks_inspection", resourceId: p.id });
    });
    log.info({ id: p.id }, "inspection created");
  });

  queue.subscribe(COMMANDS.inspectionComplete, async (msg) => {
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
        topic: EVENTS.inspectionCompleted, eventType: EVENTS.inspectionCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { inspectionId: p.id, workOrderRequired: p.workOrderRequired },
      });
      await writeAudit(tx, ctxOf(msg), { action: "inspection.complete", resourceType: "parks_inspection", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "inspection completed");
  });
}
