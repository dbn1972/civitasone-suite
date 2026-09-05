import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateComplaintNumber, routeComplaint } from "./domain.js";

const log = pino({ name: "animal.complaints.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerComplaintConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.reportComplaint, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      location: Record<string, unknown>;
      animalType: string;
      complaintType: string;
      description?: string;
      photo?: string;
      severity: string;
    };
    const suggestedTeam = routeComplaint(p.animalType, p.severity);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Sequence number reserved inside this transaction (see
      // repo.nextComplaintNumber) -- replaces the old
      // `Date.now() % 999999` scheme, which collided every ~16.7 minutes
      // under any real load (that expression is periodic on exactly that
      // interval) and had no DB-level guarantee of uniqueness beyond the
      // UNIQUE constraint rejecting the second insert outright.
      const complaintNumber = generateComplaintNumber("ULB", await repo.nextComplaintNumber(tx));
      await repo.insertComplaint(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        complaintNumber,
        reportedBy: msg.actorId,
        location: p.location as never,
        animalType: p.animalType,
        complaintType: p.complaintType,
        description: p.description ?? null,
        photo: p.photo ?? null,
        severity: p.severity,
        status: "reported",
        assignedTo: null,
        assignedTeam: suggestedTeam,
        resolvedAt: null,
        resolution: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.complaintReported,
        eventType: EVENTS.complaintReported,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id, complaintNumber, animalType: p.animalType, severity: p.severity },
      });
      // Citizen-meaningful: acknowledgement that the complaint was
      // received, with a reference number to track it -- the actor here is
      // the citizen themselves (repo.insertComplaint sets
      // reportedBy: msg.actorId, mirrored from complaints/commands.ts's
      // reportComplaint publishing with no separate reportedBy field), so
      // no pre-tx recipient lookup is needed. animal_complaints has no
      // citizen display-name column (only the reportedBy uuid), so
      // `recipient` is the complaint's own reference number, the same
      // fallback sewerage-service used for an identical reason.
      // recipientId is msg.actorId (== reportedBy) rather than the
      // complaint's own id: it identifies the actual citizen for
      // notification-service to route to, which is more useful than the
      // complaint id itself.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: complaintNumber,
        recipientId: msg.actorId,
        variables: { complaintId: p.id, complaintNumber, animalType: p.animalType, severity: p.severity },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.report",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "animal complaint reported");
  });

  queue.subscribe(COMMANDS.assignComplaint, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; assignedTo: string; assignedTeam: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "assigned", msg.actorId, ["reported"], {
        assignedTo: p.assignedTo,
        assignedTeam: p.assignedTeam,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintAssigned,
        eventType: EVENTS.complaintAssigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id, assignedTo: p.assignedTo, assignedTeam: p.assignedTeam },
      });
      // Internal workflow step (which staff member/team picks up the
      // complaint) -- deliberately not notified. The citizen already has
      // their acknowledgement (reportComplaint, above) and gets no new
      // actionable information from *which* internal team was assigned;
      // the citizen-facing milestones are report, dispatch, action-taken
      // and close (same reasoning sewerage-service applied to its own
      // complaintAssign).
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.assign",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    // GET /v1/animal/complaints/:id (complaints/routes.ts) serves through a
    // read-through cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });

  queue.subscribe(COMMANDS.dispatchTeam, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    // Recipient-lookup read BEFORE opening the write transaction --
    // complaintNumber/reportedBy aren't in this command's payload ({id,
    // tenantId} only) -- see registration/consumer.ts's renewRegistration
    // for the identical PR #1028 rationale.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "dispatched", msg.actorId, ["assigned"]);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.teamDispatched,
        eventType: EVENTS.teamDispatched,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      // Citizen-meaningful: unlike assignment, dispatch means a team is
      // now actually on the way -- actionable news for whoever reported a
      // stray/injured/dangerous animal.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.complaintNumber,
          recipientId: existing.reportedBy,
          variables: { complaintId: p.id, complaintNumber: existing.complaintNumber, status: "dispatched" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.dispatch",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });

  // NEW consumer: closes the previously-dead action_taken transition (see
  // routes.ts's /action-taken route and domain.ts's VALID_TRANSITIONS).
  queue.subscribe(COMMANDS.markActionTaken, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    // Recipient-lookup read BEFORE opening the write transaction -- same
    // rationale as dispatchTeam above.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "action_taken", msg.actorId, ["dispatched"]);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.actionTaken,
        eventType: EVENTS.actionTaken,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      // Citizen-meaningful: field action has actually been taken on the
      // animal (capture/treatment/etc. -- see operations/consumer.ts,
      // which logs the specific operation but is not itself citizen-
      // facing). This is the "something happened" milestone ahead of the
      // final close.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.complaintNumber,
          recipientId: existing.reportedBy,
          variables: { complaintId: p.id, complaintNumber: existing.complaintNumber, status: "action_taken" },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.action_taken",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });

  queue.subscribe(COMMANDS.closeComplaint, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; resolution: string };
    // Recipient-lookup read BEFORE opening the write transaction -- same
    // rationale as dispatchTeam/markActionTaken above.
    const existing = await repo.findById(p.id, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "closed", msg.actorId, ["action_taken"], {
        resolvedAt: new Date(),
        resolution: p.resolution,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintClosed,
        eventType: EVENTS.complaintClosed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id, resolution: p.resolution },
      });
      // Citizen-meaningful: unlike sewerage-service (where "resolved" is
      // the citizen milestone and "closed" is pure internal bookkeeping
      // after it), this service's own transition table
      // (complaints/domain.ts's VALID_TRANSITIONS) has no separate
      // "resolved" state -- action_taken -> closed IS the final
      // resolution, carrying the resolution text itself, so it is the
      // citizen-facing terminal notification.
      if (existing) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
          recipient: existing.complaintNumber,
          recipientId: existing.reportedBy,
          variables: {
            complaintId: p.id,
            complaintNumber: existing.complaintNumber,
            status: "closed",
            resolution: p.resolution,
          },
        });
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.close",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });
}
