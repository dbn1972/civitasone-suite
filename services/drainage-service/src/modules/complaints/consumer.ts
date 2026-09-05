import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "drainage.complaints.consumer" });

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
        reportedBy: p.reportedBy, location: p.location, complaintType: p.complaintType,
        description: p.description, photo: p.photo, severity: p.severity, status: "reported",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.complaintCreated, eventType: EVENTS.complaintCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, complaintNumber: p.complaintNumber, complaintType: p.complaintType, severity: p.severity },
      });
      // Citizen-meaningful: acknowledgement that the complaint was received,
      // with a reference number to track it. complaintNumber is already in
      // this command's own payload (see commands.ts's createComplaint) and
      // the actor here is the citizen themselves (reportedBy: ctx.actorId),
      // so no pre-tx recipient lookup is needed — unlike complaintAssign/
      // Resolve below.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: p.complaintNumber,
        recipientId: p.id,
        variables: { complaintId: p.id, complaintNumber: p.complaintNumber, complaintType: p.complaintType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "complaint.create", resourceType: "drainage_complaint", resourceId: p.id });
    });
    log.info({ id: p.id }, "complaint created");
  });

  queue.subscribe(COMMANDS.complaintAssign, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction —
    // complaintNumber isn't in this command's payload ({id, assignedTo,
    // version}). Reusing db.transaction here instead (a *nested*
    // db.transaction()/scopedRead() inside the write tx) would open a
    // second connection on the same pool and risks the exact self-deadlock
    // PR #1028 found and fixed in notification-service's checkQuota/
    // checkDlt under concurrent load — so this read happens first, on its
    // own connection, well before BEGIN for the write below.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "assigned", assignedTo: p.assignedTo, assignedAt: new Date(), updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintAssigned, eventType: EVENTS.complaintAssigned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id, assignedTo: p.assignedTo },
      });
      // Citizen-meaningful: a field crew has been dispatched to their
      // complaint (unlike sewerage-service's own complaintAssign, where
      // assignment is treated as purely internal — drainage complaints
      // trend more urgent/public-safety-adjacent, e.g. waterlogging or a
      // blocked drain, so "your complaint is now being actioned" is real
      // signal here).
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.complaintNumber,
          recipientId: p.id,
          variables: { complaintId: p.id, complaintNumber: existing.complaintNumber, status: "dispatched" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "complaint.assign", resourceType: "drainage_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint assigned");
  });

  queue.subscribe(COMMANDS.complaintResolve, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction — same
    // reasoning as complaintAssign above; complaintNumber isn't in this
    // command's payload ({id, resolution, version}).
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "resolved", resolution: p.resolution, resolvedAt: new Date(), updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintResolved, eventType: EVENTS.complaintResolved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      // Citizen-meaningful: the complaint has been resolved.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.complaintNumber,
          recipientId: p.id,
          variables: { complaintId: p.id, complaintNumber: existing.complaintNumber, status: "resolved" },
        });
      }
      await writeAudit(tx, ctxOf(msg), { action: "complaint.resolve", resourceType: "drainage_complaint", resourceId: p.id });
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
      // Internal bookkeeping terminal step following resolution — the
      // citizen was already notified at complaintResolve above, and
      // "closed" carries no new information or action for them.
      await writeAudit(tx, ctxOf(msg), { action: "complaint.close", resourceType: "drainage_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint closed");
  });
}
