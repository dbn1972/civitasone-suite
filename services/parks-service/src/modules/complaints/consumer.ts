import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "parks.complaints.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerComplaintConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.complaintCreate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintNumber: p.complaintNumber,
        reportedBy: p.reportedBy, location: p.location, parkAssetRef: p.parkAssetRef,
        complaintType: p.complaintType, description: p.description, photo: p.photo,
        severity: p.severity, status: "reported",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.complaintCreated, eventType: EVENTS.complaintCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, complaintNumber: p.complaintNumber, complaintType: p.complaintType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.create", resourceType: "parks_complaint", resourceId: p.id });
    });
    log.info({ id: p.id }, "complaint created");
  });

  queue.subscribe(COMMANDS.complaintAssign, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "assigned", assignedTo: p.assignedTo, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintAssigned, eventType: EVENTS.complaintAssigned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, assignedTo: p.assignedTo },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.assign", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint assigned");
  });

  queue.subscribe(COMMANDS.complaintResolve, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "resolved", resolution: p.resolution, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintResolved, eventType: EVENTS.complaintResolved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.resolve", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint resolved");
  });

  queue.subscribe(COMMANDS.complaintClose, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "closed", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintClosed, eventType: EVENTS.complaintClosed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.close", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint closed");
  });
}
