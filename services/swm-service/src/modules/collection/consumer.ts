import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "swm.collection.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerCollectionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.collectionRequest, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRequest(tx, {
        id: p.id, tenantId: msg.tenantId, requestNumber: p.requestNumber,
        requestedBy: p.requestedBy, wasteType: p.wasteType,
        estimatedQuantity: p.estimatedQuantity, address: p.address,
        preferredDate: p.preferredDate, preferredSlot: p.preferredSlot,
        status: "requested", feeMinor: p.feeMinor,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.collectionRequested, eventType: EVENTS.collectionRequested,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id, requestNumber: p.requestNumber, wasteType: p.wasteType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "collection.request", resourceType: "swm_collection_request", resourceId: p.id });
    });
    log.info({ id: p.id }, "collection requested");
  });

  queue.subscribe(COMMANDS.collectionSchedule, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateRequest(tx, p.id, msg.tenantId, { status: "scheduled", vehicleId: p.vehicleId, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.collectionScheduled, eventType: EVENTS.collectionScheduled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id, vehicleId: p.vehicleId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "collection.schedule", resourceType: "swm_collection_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "collection scheduled");
  });

  queue.subscribe(COMMANDS.collectionComplete, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateRequest(tx, p.id, msg.tenantId, { status: "collected", feePaid: true, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.collectionCompleted, eventType: EVENTS.collectionCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "collection.complete", resourceType: "swm_collection_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "collection completed");
  });

  queue.subscribe(COMMANDS.collectionCancel, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateRequest(tx, p.id, msg.tenantId, { status: "cancelled", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.collectionCancelled, eventType: EVENTS.collectionCancelled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "collection.cancel", resourceType: "swm_collection_request", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "collection cancelled");
  });

  queue.subscribe(COMMANDS.fieldTaskCreate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertTask(tx, {
        id: p.id, tenantId: msg.tenantId, taskNumber: p.taskNumber,
        routeId: p.routeId, zoneId: p.zoneId, assignedTo: p.assignedTo,
        taskDate: p.taskDate, assetRefs: p.assetRefs, status: "assigned",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.fieldTaskCreated, eventType: EVENTS.fieldTaskCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { taskId: p.id, taskNumber: p.taskNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "field_task.create", resourceType: "swm_field_task", resourceId: p.id });
    });
    log.info({ id: p.id }, "field task created");
  });

  queue.subscribe(COMMANDS.fieldTaskComplete, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateTask(tx, p.id, msg.tenantId, {
        status: "completed", completedAt: new Date(), notes: p.notes, photos: p.photos, updatedBy: msg.actorId,
      }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.fieldTaskCompleted, eventType: EVENTS.fieldTaskCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { taskId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "field_task.complete", resourceType: "swm_field_task", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "field task completed");
  });
}
