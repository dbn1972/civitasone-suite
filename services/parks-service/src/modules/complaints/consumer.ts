import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { formatComplaintNumber } from "./domain.js";

const log = pino({ name: "parks.complaints.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerComplaintConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.CREATE_COMPLAINT, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reserved inside this transaction (see repo.nextComplaintNumber) —
      // replaces the old `PRK-${Date.now()}` scheme, which collided under
      // concurrent load and had no DB-level guarantee of uniqueness beyond
      // the UNIQUE constraint rejecting the second insert outright.
      const complaintNumber = formatComplaintNumber(await repo.nextComplaintNumber(tx));
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintNumber,
        reportedBy: p.reportedBy, location: p.location, parkAssetRef: p.parkAssetRef,
        complaintType: p.complaintType, description: p.description, photo: p.photo,
        severity: p.severity, status: "reported",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.COMPLAINT_CREATED, eventType: EVENTS.COMPLAINT_CREATED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, complaintNumber, complaintType: p.complaintType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.create", resourceType: "parks_complaint", resourceId: p.id });
    });
    log.info({ id: p.id }, "complaint created");
  });

  queue.subscribe(COMMANDS.ASSIGN_COMPLAINT, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "assigned", assignedTo: p.assignedTo, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.COMPLAINT_ASSIGNED, eventType: EVENTS.COMPLAINT_ASSIGNED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, assignedTo: p.assignedTo },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.assign", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint assigned");
  });

  queue.subscribe(COMMANDS.RESOLVE_COMPLAINT, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "resolved", resolution: p.resolution, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.COMPLAINT_RESOLVED, eventType: EVENTS.COMPLAINT_RESOLVED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.resolve", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint resolved");
  });

  queue.subscribe(COMMANDS.CLOSE_COMPLAINT, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "closed", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.COMPLAINT_CLOSED, eventType: EVENTS.COMPLAINT_CLOSED,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.close", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint closed");
  });
}
