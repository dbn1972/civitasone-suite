import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { formatComplaintNumber } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "sewerage.complaints.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerComplaintConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.complaintCreate, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reserved inside this transaction (see repo.nextComplaintNumber) —
      // replaces the old `SEWC-${Date.now()}` scheme.
      const complaintNumber = formatComplaintNumber(await repo.nextComplaintNumber(tx));
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, complaintNumber,
        reportedBy: p.reportedBy, location: p.location, complaintType: p.complaintType,
        description: p.description, photo: p.photo, severity: p.severity, status: "reported",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintCreated, eventType: EVENTS.complaintCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, complaintNumber, complaintType: p.complaintType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.create", resourceType: "sewerage_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint created");
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
      await writeAudit(tx, ctxOf(msg), { action: "complaint.assign", resourceType: "sewerage_complaint", resourceId: p.id });
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
      await writeAudit(tx, ctxOf(msg), { action: "complaint.resolve", resourceType: "sewerage_complaint", resourceId: p.id });
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
      await writeAudit(tx, ctxOf(msg), { action: "complaint.close", resourceType: "sewerage_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint closed");
  });

  queue.subscribe(COMMANDS.fieldRecordCreate, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Defense-in-depth existence re-check: routes.ts already rejects a
      // nonexistent complaintId before the command is even published, but
      // this guards the case a command reaches the queue by any path other
      // than that route (mirrors parks-service's inspections consumer,
      // PR #1010). Drop (not insert) rather than throw — same "no-op on bad
      // reference" contract as every version-guarded update in this file.
      if (p.complaintId) {
        const complaint = await repo.findByIdTx(tx, p.complaintId, msg.tenantId);
        if (!complaint) return;
      }
      await repo.insertFieldRecord(tx, {
        id: p.id, tenantId: msg.tenantId, complaintId: p.complaintId,
        bookingId: p.bookingId, assetRef: p.assetRef, manholeRef: p.manholeRef,
        workPerformed: p.workPerformed, beforePhoto: p.beforePhoto, afterPhoto: p.afterPhoto,
        closedBy: msg.actorId, closedAt: new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.fieldRecordCreated, eventType: EVENTS.fieldRecordCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fieldRecordId: p.id, complaintId: p.complaintId, bookingId: p.bookingId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "field_record.create", resourceType: "sewerage_field_record", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "field record created");
  });
}
