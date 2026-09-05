import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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
      // Citizen-meaningful: acknowledgement that the complaint was received,
      // with a reference number to track it. reportedBy is supplied directly
      // on this command's payload (unlike animal-service, where the reporter
      // is always the acting citizen) so no pre-tx lookup is needed here.
      // parks_complaints has no citizen display-name column (only the
      // reportedBy uuid), so `recipient` is the complaint's own
      // human-readable reference number — same fallback animal-service uses
      // for the identical reason.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: complaintNumber,
        recipientId: p.reportedBy,
        variables: { complaintId: p.id, complaintNumber, complaintType: p.complaintType },
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
      // Internal workflow step (which staff member picks up the complaint)
      // — deliberately not notified. The citizen already has their
      // acknowledgement (CREATE_COMPLAINT, above) and gets no new
      // actionable information from *which* internal staff member was
      // assigned; the citizen-facing milestones are report, resolve and
      // close (mirrors the same reasoning animal-service applied to its
      // own assignComplaint).
      await writeAudit(tx, ctxOf(msg), { action: "complaint.assign", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint assigned");
  });

  queue.subscribe(COMMANDS.RESOLVE_COMPLAINT, async (msg) => {
    const p = msg.payload as any;
    // Recipient-lookup read BEFORE opening the write transaction —
    // complaintNumber/reportedBy aren't in this command's payload ({id,
    // tenantId, resolution, version} only), and reading them via
    // repo.findById's own scopedRead from inside the write db.transaction
    // below would open a SECOND, nested transaction on the same connection
    // pool as this outer transaction and risk the pool-exhaustion deadlock
    // fixed in notification-service/building-service (PR #1028/#1035) —
    // same rationale as animal-service's dispatchTeam/markActionTaken/
    // closeComplaint.
    const existing = await repo.findById(p.id, msg.tenantId);
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
      // Citizen-meaningful: unlike animal-service (whose transition table
      // has no separate "resolved" state — action_taken -> closed IS the
      // final resolution), this module's own transitions (domain.ts) keep
      // "resolved" as a real, distinct state ahead of "closed", so this IS
      // the citizen-facing terminal notification carrying the resolution
      // text; CLOSE_COMPLAINT below is pure internal bookkeeping after it.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.complaintNumber,
          recipientId: existing.reportedBy,
          variables: { complaintId: p.id, complaintNumber: existing.complaintNumber, status: "resolved", resolution: p.resolution ?? "" },
        });
      }
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
      // Internal bookkeeping after RESOLVE_COMPLAINT already sent the
      // citizen-facing terminal notification carrying the resolution text
      // — deliberately not notified again here, same as building's
      // recordFeePayment-style post-decision housekeeping steps.
      await writeAudit(tx, ctxOf(msg), { action: "complaint.close", resourceType: "parks_complaint", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "complaint closed");
  });
}
