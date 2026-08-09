/**
 * inspection-service: Encroachment module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  generateComplaintNumber,
  generateNoticeNumber,
  assertValidComplaintTransition,
  assertValidNoticeTransition,
  assertValidRemovalTransition,
  validateVerification,
  DomainError,
} from "./domain.js";
import type { ComplaintState, NoticeState, RemovalState } from "./domain.js";
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
import { tenantScoped } from "../../shared/tenant-queue.js";
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

// ── Registration ─────────────────────────────────────────────────────────────

export function registerEncroachmentConsumers(rawQueue: Queue): void {
  // ─── createComplaint ──────────────────────────────────────────────────────
  const queue = tenantScoped(rawQueue);
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
          topic: EVENTS.encroachmentComplaintCreated,
          eventType: EVENTS.encroachmentComplaintCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            complaintId: complaint.id,
            complaintNumber: complaint.complaintNumber,
            encroachmentType: p.encroachmentType,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_complaint.created",
            resourceType: "encroachment_complaint",
            resourceId: complaint.id,
            outcome: "success",
          },
        });
      });

      if (complaintId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", complaintId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── verifyComplaint ──────────────────────────────────────────────────────
  queue.subscribe<VerifyComplaintPayload & { tenantId: string }>(
    COMMANDS.encroachmentComplaintVerify,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (!complaint) throw new NonRetryableError(`Complaint not found: ${p.complaintId}`);

        try {
          assertValidComplaintTransition(complaint.status as ComplaintState, "verified");
          validateVerification(p.landVerificationReport);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateComplaint(tx, p.complaintId, msg.tenantId, {
          status: "verified",
          verifiedBy: msg.actorId,
          verifiedAt: new Date(),
          landVerificationReport: p.landVerificationReport,
          updatedBy: msg.actorId,
        }, complaint.version);

        await enqueue(tx, {
          topic: EVENTS.encroachmentComplaintVerified,
          eventType: EVENTS.encroachmentComplaintVerified,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { complaintId: p.complaintId, verifiedBy: msg.actorId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_complaint.verified",
            resourceType: "encroachment_complaint",
            resourceId: p.complaintId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_complaint", p.complaintId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── issueNotice ──────────────────────────────────────────────────────────
  queue.subscribe<IssueNoticePayload & { tenantId: string }>(
    COMMANDS.encroachmentNoticeIssue,
    async (msg) => {
      const p = msg.payload;
      let noticeId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

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

        // Transition complaint to notice_issued
        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (complaint) {
          try {
            assertValidComplaintTransition(complaint.status as ComplaintState, "notice_issued");
            await updateComplaint(tx, p.complaintId, msg.tenantId, {
              status: "notice_issued",
              updatedBy: msg.actorId,
            }, complaint.version);
          } catch {
            // If transition is not valid, skip — complaint might already be in a later state
          }
        }

        await enqueue(tx, {
          topic: EVENTS.encroachmentNoticeIssued,
          eventType: EVENTS.encroachmentNoticeIssued,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            noticeId: notice.id,
            noticeNumber: notice.noticeNumber,
            complaintId: p.complaintId,
            noticeType: p.noticeType,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_notice.issued",
            resourceType: "encroachment_notice",
            resourceId: notice.id,
            outcome: "success",
          },
        });
      });

      if (noticeId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", noticeId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── serveNotice ──────────────────────────────────────────────────────────
  queue.subscribe<ServeNoticePayload & { tenantId: string }>(
    COMMANDS.encroachmentNoticeServe,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const notice = await findNoticeById(msg.tenantId, p.noticeId);
        if (!notice) throw new NonRetryableError(`Notice not found: ${p.noticeId}`);

        try {
          assertValidNoticeTransition(notice.status as NoticeState, "served");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateNotice(tx, p.noticeId, msg.tenantId, {
          status: "served",
          servedAt: new Date(),
          updatedBy: msg.actorId,
        }, notice.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_notice.served",
            resourceType: "encroachment_notice",
            resourceId: p.noticeId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", p.noticeId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── recordNoticeResponse ─────────────────────────────────────────────────
  queue.subscribe<RecordNoticeResponsePayload & { tenantId: string }>(
    COMMANDS.encroachmentNoticeRespond,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const notice = await findNoticeById(msg.tenantId, p.noticeId);
        if (!notice) throw new NonRetryableError(`Notice not found: ${p.noticeId}`);

        try {
          assertValidNoticeTransition(notice.status as NoticeState, "response_received");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateNotice(tx, p.noticeId, msg.tenantId, {
          status: "response_received",
          responseText: p.responseText,
          updatedBy: msg.actorId,
        }, notice.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_notice.response_received",
            resourceType: "encroachment_notice",
            resourceId: p.noticeId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_notice", p.noticeId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── scheduleHearing ──────────────────────────────────────────────────────
  queue.subscribe<ScheduleHearingPayload & { tenantId: string }>(
    COMMANDS.encroachmentHearingSchedule,
    async (msg) => {
      const p = msg.payload;
      let hearingId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

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

        // Transition complaint to hearing_scheduled
        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (complaint) {
          try {
            assertValidComplaintTransition(complaint.status as ComplaintState, "hearing_scheduled");
            await updateComplaint(tx, p.complaintId, msg.tenantId, {
              status: "hearing_scheduled",
              updatedBy: msg.actorId,
            }, complaint.version);
          } catch {
            // Skip if complaint transition not valid
          }
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_hearing.scheduled",
            resourceType: "encroachment_hearing",
            resourceId: hearing.id,
            outcome: "success",
          },
        });
      });

      if (hearingId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_hearing", hearingId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── completeHearing ──────────────────────────────────────────────────────
  queue.subscribe<CompleteHearingPayload & { tenantId: string }>(
    COMMANDS.encroachmentHearingComplete,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const hearing = await findHearingById(msg.tenantId, p.hearingId);
        if (!hearing) throw new NonRetryableError(`Hearing not found: ${p.hearingId}`);

        const targetStatus = p.decision === "adjourned" ? "adjourned" as const : "completed" as const;

        await updateHearing(tx, p.hearingId, msg.tenantId, {
          attendees: p.attendees ?? null,
          proceedings: p.proceedings,
          decision: p.decision,
          fineAmountMinor: p.fineAmountMinor ? BigInt(p.fineAmountMinor) : null,
          nextHearingDate: p.nextHearingDate ?? null,
          status: targetStatus,
          updatedBy: msg.actorId,
        }, hearing.version);

        // Transition complaint to hearing_done
        const complaint = await findComplaintById(msg.tenantId, hearing.complaintId);
        if (complaint && targetStatus === "completed") {
          try {
            assertValidComplaintTransition(complaint.status as ComplaintState, "hearing_done");
            await updateComplaint(tx, hearing.complaintId, msg.tenantId, {
              status: "hearing_done",
              updatedBy: msg.actorId,
            }, complaint.version);
          } catch {
            // Skip if complaint transition not valid
          }
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_hearing.completed",
            resourceType: "encroachment_hearing",
            resourceId: p.hearingId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_hearing", p.hearingId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── orderRemoval ─────────────────────────────────────────────────────────
  queue.subscribe<OrderRemovalPayload & { tenantId: string }>(
    COMMANDS.encroachmentRemovalOrder,
    async (msg) => {
      const p = msg.payload;
      let removalId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

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

        // Transition complaint to removal_ordered
        const complaint = await findComplaintById(msg.tenantId, p.complaintId);
        if (complaint) {
          try {
            assertValidComplaintTransition(complaint.status as ComplaintState, "removal_ordered");
            await updateComplaint(tx, p.complaintId, msg.tenantId, {
              status: "removal_ordered",
              updatedBy: msg.actorId,
            }, complaint.version);
          } catch {
            // Skip if transition not valid
          }
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_removal.ordered",
            resourceType: "encroachment_removal",
            resourceId: removal.id,
            outcome: "success",
          },
        });
      });

      if (removalId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_removal", removalId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── assignRemovalTeam ────────────────────────────────────────────────────
  queue.subscribe<AssignRemovalTeamPayload & { tenantId: string }>(
    COMMANDS.encroachmentRemovalAssignTeam,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const removal = await findRemovalById(msg.tenantId, p.removalId);
        if (!removal) throw new NonRetryableError(`Removal not found: ${p.removalId}`);

        try {
          assertValidRemovalTransition(removal.status as RemovalState, "team_assigned");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateRemoval(tx, p.removalId, msg.tenantId, {
          status: "team_assigned",
          teamMembers: p.teamMembers,
          equipmentUsed: p.equipmentUsed ?? null,
          updatedBy: msg.actorId,
        }, removal.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_removal.team_assigned",
            resourceType: "encroachment_removal",
            resourceId: p.removalId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_removal", p.removalId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── completeRemoval ──────────────────────────────────────────────────────
  queue.subscribe<CompleteRemovalPayload & { tenantId: string }>(
    COMMANDS.encroachmentRemovalComplete,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const removal = await findRemovalById(msg.tenantId, p.removalId);
        if (!removal) throw new NonRetryableError(`Removal not found: ${p.removalId}`);

        // Allow completing from team_assigned or in_progress
        const currentState = removal.status as RemovalState;
        if (currentState === "team_assigned") {
          // Transition through in_progress first (logically)
          try { assertValidRemovalTransition("in_progress", "completed"); } catch (err) {
            if (err instanceof DomainError) throw new NonRetryableError(err.message);
            throw err;
          }
        } else {
          try { assertValidRemovalTransition(currentState, "completed"); } catch (err) {
            if (err instanceof DomainError) throw new NonRetryableError(err.message);
            throw err;
          }
        }

        await updateRemoval(tx, p.removalId, msg.tenantId, {
          status: "completed",
          completedAt: new Date(),
          completionReport: p.completionReport,
          photos: p.photos ?? null,
          updatedBy: msg.actorId,
        }, removal.version);

        // Transition complaint to removed
        const complaint = await findComplaintById(msg.tenantId, removal.complaintId);
        if (complaint) {
          try {
            assertValidComplaintTransition(complaint.status as ComplaintState, "removed");
            await updateComplaint(tx, removal.complaintId, msg.tenantId, {
              status: "removed",
              updatedBy: msg.actorId,
            }, complaint.version);
          } catch {
            // Skip if transition not valid
          }
        }

        await enqueue(tx, {
          topic: EVENTS.encroachmentRemovalCompleted,
          eventType: EVENTS.encroachmentRemovalCompleted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            removalId: p.removalId,
            complaintId: removal.complaintId,
            completedAt: new Date().toISOString(),
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "encroachment_removal.completed",
            resourceType: "encroachment_removal",
            resourceId: p.removalId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "encroachment_removal", p.removalId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );
}
