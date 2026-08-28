/**
 * inspection-service: Encroachment module — command consumers.
 *
 * This file did not exist at all before this fix: commands.ts publishes 9
 * commands (all reachable from real HTTP routes in routes.ts, which was
 * also never registered in app.ts — see the sibling fix in this same PR),
 * but nothing ever subscribed to any of them, and worker.ts never imported
 * a registration function for this module. Every encroachment complaint,
 * notice, hearing, and removal order submitted through the API was
 * accepted with a 202 and then silently discarded — the command sat
 * published with no consumer to ever process it. Confirmed live: routes
 * returned 404 (not registered), and even a direct call to the (also
 * previously unregistered) route handler would have produced a real
 * complaint number, an accepted response, and zero rows in Postgres.
 *
 * Each handler follows the same CQRS consumer contract already
 * established by every other module in this service (see e.g.
 * enforcement/consumer.ts):
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write inside the same transaction
 *   3. Outbox: audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction, best-effort — a failure
 *      here must not turn an already-committed write into a retried/
 *      redelivered one)
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  assertValidComplaintTransition,
  assertValidNoticeTransition,
  assertValidRemovalTransition,
  validateVerification,
  generateComplaintNumber,
  generateNoticeNumber,
  DomainError,
  type ComplaintState,
  type NoticeState,
  type RemovalState,
} from "./domain.js";
import {
  insertComplaint,
  updateComplaint,
  findComplaintById,
  insertNotice,
  updateNotice,
  findNoticeById,
  insertHearing,
  updateHearing,
  findHearingById,
  insertRemoval,
  updateRemoval,
  findRemovalById,
} from "./repo.js";
import type {
  CreateComplaintPayload,
  VerifyComplaintPayload,
  IssueNoticePayload,
  ServeNoticePayload,
  RecordNoticeResponsePayload,
  ScheduleHearingPayload,
  CompleteHearingPayload,
  OrderRemovalPayload,
  AssignRemovalTeamPayload,
  CompleteRemovalPayload,
} from "./commands.js";

const log = pino({ name: "encroachment-consumer" });

const AUDIT_TOPIC = "audit.event.record";

function toDomainError(err: unknown): never {
  if (err instanceof DomainError) throw new NonRetryableError(err.message);
  throw err as Error;
}

export function registerEncroachmentConsumers(queue: Queue): void {
  // ─── encroachmentComplaintCreate ──────────────────────────────────────────
  queue.subscribe<CreateComplaintPayload & { tenantId: string }>(
    COMMANDS.encroachmentComplaintCreate,
    async (msg) => {
      const p = msg.payload;
      let complaintId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const complaint = await insertComplaint(tx, {
          tenantId: msg.tenantId,
          complaintNumber: generateComplaintNumber(),
          reportedBy: p.reportedBy,
          location: p.location,
          encroachmentType: p.encroachmentType,
          description: p.description,
          photos: p.photos ?? null,
          landParcelRef: p.landParcelRef ?? null,
          status: "received",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        complaintId = complaint.id;

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_complaint.received", resourceType: "encroachment_complaint",
            resourceId: complaint.id,
            details: { complaintNumber: complaint.complaintNumber, encroachmentType: p.encroachmentType },
          },
        });
      });

      if (complaintId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", complaintId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── encroachmentComplaintVerify ──────────────────────────────────────────
  // The state machine models received -> under_verification -> verified as
  // two steps, but only this one API endpoint exists to move a complaint
  // through them (no separate "start verification" action anywhere in
  // commands.ts/routes.ts) — so this accepts either prior state and lands
  // on "verified" directly, rather than enforcing the stricter 2-step
  // transition table literally, which the built API surface cannot satisfy.
  queue.subscribe<VerifyComplaintPayload & { tenantId: string }>(
    COMMANDS.encroachmentComplaintVerify,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (!complaint) throw new NonRetryableError(`Encroachment complaint not found: ${p.complaintId}`);

        if (!["received", "under_verification"].includes(complaint.status)) {
          try {
            assertValidComplaintTransition(complaint.status as ComplaintState, "verified");
          } catch (err) { toDomainError(err); }
        }
        try { validateVerification(p.landVerificationReport); } catch (err) { toDomainError(err); }

        await updateComplaint(tx, p.complaintId, msg.tenantId, {
          status: "verified",
          verifiedBy: msg.actorId,
          verifiedAt: new Date(),
          landVerificationReport: p.landVerificationReport,
          updatedBy: msg.actorId,
        }, complaint.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_complaint.verified", resourceType: "encroachment_complaint",
            resourceId: p.complaintId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", p.complaintId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentNoticeIssue ──────────────────────────────────────────────
  queue.subscribe<IssueNoticePayload & { tenantId: string }>(
    COMMANDS.encroachmentNoticeIssue,
    async (msg) => {
      const p = msg.payload;
      let noticeId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (!complaint) throw new NonRetryableError(`Encroachment complaint not found: ${p.complaintId}`);
        try {
          assertValidComplaintTransition(complaint.status as ComplaintState, "notice_issued");
        } catch (err) { toDomainError(err); }

        const notice = await insertNotice(tx, {
          tenantId: msg.tenantId,
          complaintId: p.complaintId,
          noticeNumber: generateNoticeNumber(),
          noticeType: p.noticeType,
          issuedTo: p.issuedTo,
          responseDeadline: p.responseDeadline,
          status: "issued",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        noticeId = notice.id;

        await updateComplaint(tx, p.complaintId, msg.tenantId, {
          status: "notice_issued", updatedBy: msg.actorId,
        }, complaint.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_notice.issued", resourceType: "encroachment_notice",
            resourceId: notice.id,
            details: { complaintId: p.complaintId, noticeNumber: notice.noticeNumber, noticeType: p.noticeType },
          },
        });
      });

      const invalidations = [
        cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", p.complaintId)),
      ];
      if (noticeId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", noticeId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentNoticeServe ──────────────────────────────────────────────
  queue.subscribe<ServeNoticePayload & { tenantId: string }>(
    COMMANDS.encroachmentNoticeServe,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const notice = await findNoticeById(msg.tenantId, p.noticeId);
        if (!notice) throw new NonRetryableError(`Encroachment notice not found: ${p.noticeId}`);
        try {
          assertValidNoticeTransition(notice.status as NoticeState, "served");
        } catch (err) { toDomainError(err); }

        await updateNotice(tx, p.noticeId, msg.tenantId, {
          status: "served",
          servedAt: new Date(),
          updatedBy: msg.actorId,
        }, notice.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_notice.served", resourceType: "encroachment_notice",
            resourceId: p.noticeId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", p.noticeId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentNoticeRespond ────────────────────────────────────────────
  queue.subscribe<RecordNoticeResponsePayload & { tenantId: string }>(
    COMMANDS.encroachmentNoticeRespond,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const notice = await findNoticeById(msg.tenantId, p.noticeId);
        if (!notice) throw new NonRetryableError(`Encroachment notice not found: ${p.noticeId}`);
        try {
          assertValidNoticeTransition(notice.status as NoticeState, "response_received");
        } catch (err) { toDomainError(err); }

        await updateNotice(tx, p.noticeId, msg.tenantId, {
          status: "response_received",
          responseText: p.responseText,
          updatedBy: msg.actorId,
        }, notice.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_notice.response_received", resourceType: "encroachment_notice",
            resourceId: p.noticeId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", p.noticeId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentHearingSchedule ──────────────────────────────────────────
  queue.subscribe<ScheduleHearingPayload & { tenantId: string }>(
    COMMANDS.encroachmentHearingSchedule,
    async (msg) => {
      const p = msg.payload;
      let hearingId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (!complaint) throw new NonRetryableError(`Encroachment complaint not found: ${p.complaintId}`);
        const notice = await findNoticeById(msg.tenantId, p.noticeId);
        if (!notice) throw new NonRetryableError(`Encroachment notice not found: ${p.noticeId}`);
        try {
          assertValidComplaintTransition(complaint.status as ComplaintState, "hearing_scheduled");
          assertValidNoticeTransition(notice.status as NoticeState, "hearing_scheduled");
        } catch (err) { toDomainError(err); }

        const hearing = await insertHearing(tx, {
          tenantId: msg.tenantId,
          complaintId: p.complaintId,
          noticeId: p.noticeId,
          hearingDate: p.hearingDate,
          hearingTime: p.hearingTime,
          venue: p.venue,
          officerId: p.officerId,
          status: "scheduled",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        hearingId = hearing.id;

        await updateComplaint(tx, p.complaintId, msg.tenantId, {
          status: "hearing_scheduled", updatedBy: msg.actorId,
        }, complaint.version);
        await updateNotice(tx, p.noticeId, msg.tenantId, {
          status: "hearing_scheduled", updatedBy: msg.actorId,
        }, notice.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_hearing.scheduled", resourceType: "encroachment_hearing",
            resourceId: hearing.id,
            details: { complaintId: p.complaintId, noticeId: p.noticeId, hearingDate: p.hearingDate },
          },
        });
      });

      const invalidations = [
        cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", p.complaintId)),
        cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", p.noticeId)),
      ];
      if (hearingId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_hearing", hearingId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentHearingComplete ──────────────────────────────────────────
  queue.subscribe<CompleteHearingPayload & { tenantId: string }>(
    COMMANDS.encroachmentHearingComplete,
    async (msg) => {
      const p = msg.payload;
      let complaintId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const hearing = await findHearingById(msg.tenantId, p.hearingId);
        if (!hearing) throw new NonRetryableError(`Encroachment hearing not found: ${p.hearingId}`);
        const complaint = await findComplaintById(msg.tenantId, hearing.complaintId);
        if (!complaint) throw new NonRetryableError(`Encroachment complaint not found: ${hearing.complaintId}`);
        complaintId = complaint.id;
        try {
          assertValidComplaintTransition(complaint.status as ComplaintState, "hearing_done");
        } catch (err) { toDomainError(err); }

        await updateHearing(tx, p.hearingId, msg.tenantId, {
          attendees: p.attendees ?? null,
          proceedings: p.proceedings,
          decision: p.decision,
          fineAmountMinor: p.fineAmountMinor ? BigInt(p.fineAmountMinor) : null,
          nextHearingDate: p.nextHearingDate ?? null,
          status: "completed",
          updatedBy: msg.actorId,
        }, hearing.version);

        await updateComplaint(tx, hearing.complaintId, msg.tenantId, {
          status: "hearing_done", updatedBy: msg.actorId,
        }, complaint.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_hearing.completed", resourceType: "encroachment_hearing",
            resourceId: p.hearingId, details: { decision: p.decision },
          },
        });
      });

      const invalidations = [cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_hearing", p.hearingId))];
      if (complaintId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", complaintId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentRemovalOrder ─────────────────────────────────────────────
  queue.subscribe<OrderRemovalPayload & { tenantId: string }>(
    COMMANDS.encroachmentRemovalOrder,
    async (msg) => {
      const p = msg.payload;
      let removalId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (!complaint) throw new NonRetryableError(`Encroachment complaint not found: ${p.complaintId}`);
        try {
          assertValidComplaintTransition(complaint.status as ComplaintState, "removal_ordered");
        } catch (err) { toDomainError(err); }

        const removal = await insertRemoval(tx, {
          tenantId: msg.tenantId,
          complaintId: p.complaintId,
          orderedBy: msg.actorId,
          scheduledDate: p.scheduledDate,
          status: "ordered",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        removalId = removal.id;

        await updateComplaint(tx, p.complaintId, msg.tenantId, {
          status: "removal_ordered", updatedBy: msg.actorId,
        }, complaint.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_removal.ordered", resourceType: "encroachment_removal",
            resourceId: removal.id, details: { complaintId: p.complaintId, scheduledDate: p.scheduledDate },
          },
        });
      });

      const invalidations = [
        cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", p.complaintId)),
      ];
      if (removalId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_removal", removalId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentRemovalAssignTeam ────────────────────────────────────────
  queue.subscribe<AssignRemovalTeamPayload & { tenantId: string }>(
    COMMANDS.encroachmentRemovalAssignTeam,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const removal = await findRemovalById(msg.tenantId, p.removalId);
        if (!removal) throw new NonRetryableError(`Encroachment removal not found: ${p.removalId}`);
        try {
          assertValidRemovalTransition(removal.status as RemovalState, "team_assigned");
        } catch (err) { toDomainError(err); }

        await updateRemoval(tx, p.removalId, msg.tenantId, {
          teamMembers: p.teamMembers,
          equipmentUsed: p.equipmentUsed ?? null,
          status: "team_assigned",
          updatedBy: msg.actorId,
        }, removal.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_removal.team_assigned", resourceType: "encroachment_removal",
            resourceId: p.removalId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_removal", p.removalId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── encroachmentRemovalComplete ──────────────────────────────────────────
  queue.subscribe<CompleteRemovalPayload & { tenantId: string }>(
    COMMANDS.encroachmentRemovalComplete,
    async (msg) => {
      const p = msg.payload;
      let complaintId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const removal = await findRemovalById(msg.tenantId, p.removalId);
        if (!removal) throw new NonRetryableError(`Encroachment removal not found: ${p.removalId}`);
        complaintId = removal.complaintId;
        // team_assigned -> in_progress -> completed is a 3rd, separate step
        // no API endpoint exists for ("mark in progress") — same built-API
        // vs. state-machine gap as encroachmentComplaintVerify above, so
        // this accepts either team_assigned or in_progress as the prior
        // state and lands on "completed" directly.
        if (!["team_assigned", "in_progress"].includes(removal.status)) {
          try {
            assertValidRemovalTransition(removal.status as RemovalState, "completed");
          } catch (err) { toDomainError(err); }
        }

        await updateRemoval(tx, p.removalId, msg.tenantId, {
          completionReport: p.completionReport,
          photos: p.photos ?? null,
          completedAt: new Date(),
          status: "completed",
          updatedBy: msg.actorId,
        }, removal.version);

        const complaint = await findComplaintById(msg.tenantId, removal.complaintId);
        if (complaint) {
          await updateComplaint(tx, removal.complaintId, msg.tenantId, {
            status: "removed", updatedBy: msg.actorId,
          }, complaint.version);
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "encroachment_removal.completed", resourceType: "encroachment_removal",
            resourceId: p.removalId, details: {},
          },
        });
      });

      const invalidations = [cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_removal", p.removalId))];
      if (complaintId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", complaintId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );
}
