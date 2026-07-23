/**
 * inspection-service: execution module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * inspectionTransition: assertValidTransition → update state → record history → emit event → notify
 * inspectionSubmitReview: validate completed → assign reviewer → transition under_review → notify
 * inspectionFinalize: generate report ref → lock data → transition finalized
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  assertValidTransition,
  DomainError,
  type InspectionState,
} from "./domain.js";
import {
  updateInspectionState,
  insertHistory,
  findInspectionById,
} from "./repo.js";
import type {
  InspectionTransitionPayload,
  InspectionSubmitReviewPayload,
  InspectionFinalizePayload,
} from "./commands.js";

const log = pino({ name: "execution-consumer" });

const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.send";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerExecutionConsumers(queue: Queue): void {
  // ─── inspectionTransition ─────────────────────────────────────────────────
  queue.subscribe<InspectionTransitionPayload & { tenantId: string }>(
    COMMANDS.inspectionTransition,
    async (msg) => {
      const p = msg.payload;
      let inspectionId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Load current inspection
        const inspection = await findInspectionById(msg.tenantId, p.inspectionId);
        if (!inspection) {
          throw new NonRetryableError(
            `Inspection not found: ${p.inspectionId} (tenant: ${msg.tenantId})`,
          );
        }

        const currentState = inspection.state as InspectionState;
        const targetState = p.targetState as InspectionState;

        // 2. Validate transition via state machine (Req 8.1, 8.7)
        try {
          assertValidTransition(currentState, targetState);
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // 3. Determine additional timestamp fields based on target state
        const additionalFields: Record<string, unknown> = {};
        if (targetState === "in_progress" && currentState === "scheduled") {
          additionalFields.startedAt = new Date();
        }
        if (targetState === "completed") {
          additionalFields.completedAt = new Date();
        }

        // 4. Update inspection state (Req 8.2)
        const updated = await updateInspectionState(
          tx,
          p.inspectionId,
          msg.tenantId,
          targetState,
          msg.actorId,
          additionalFields as Record<string, Date>,
        );

        inspectionId = updated.id;

        // 5. Record transition history (Req 8.8)
        await insertHistory(tx, {
          tenantId: msg.tenantId,
          inspectionId: p.inspectionId,
          previousState: currentState,
          newState: targetState,
          actorId: msg.actorId,
          remarks: p.remarks ?? null,
        });

        // 6. Emit domain event based on transition
        if (targetState === "in_progress" && currentState === "scheduled") {
          await enqueue(tx, {
            topic: EVENTS.inspectionStarted,
            eventType: EVENTS.inspectionStarted,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              inspectionId: p.inspectionId,
              entityId: updated.entityId,
              inspectorId: msg.actorId,
              startedAt: (additionalFields.startedAt as Date).toISOString(),
            },
          });
        }

        if (targetState === "completed") {
          await enqueue(tx, {
            topic: EVENTS.inspectionCompleted,
            eventType: EVENTS.inspectionCompleted,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              inspectionId: p.inspectionId,
              entityId: updated.entityId,
              inspectorId: msg.actorId,
              completedAt: (additionalFields.completedAt as Date).toISOString(),
            },
          });
        }

        // 7. Notification event (Req 8.5)
        await enqueue(tx, {
          topic: NOTIFICATION_TOPIC,
          eventType: NOTIFICATION_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            type: "inspection.state_changed",
            recipientIds: updated.assignedInspectors as string[],
            data: {
              inspectionId: p.inspectionId,
              previousState: currentState,
              newState: targetState,
              remarks: p.remarks,
            },
          },
        });

        // 8. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "inspection.transitioned",
            resourceType: "inspection",
            resourceId: p.inspectionId,
            details: {
              previousState: currentState,
              newState: targetState,
              remarks: p.remarks,
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (inspectionId) {
        try {
          await cache.invalidate(cache.makeKey(msg.tenantId, "inspection", inspectionId));
        } catch (err) {
          log.warn({ err, tenantId: msg.tenantId, inspectionId, event: "cache_invalidate_failed" },
            "failed to invalidate inspection cache after transition");
        }
      }
    },
  );

  // ─── inspectionSubmitReview ───────────────────────────────────────────────
  queue.subscribe<InspectionSubmitReviewPayload & { tenantId: string }>(
    COMMANDS.inspectionSubmitReview,
    async (msg) => {
      const p = msg.payload;
      let inspectionId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Load current inspection
        const inspection = await findInspectionById(msg.tenantId, p.inspectionId);
        if (!inspection) {
          throw new NonRetryableError(
            `Inspection not found: ${p.inspectionId} (tenant: ${msg.tenantId})`,
          );
        }

        const currentState = inspection.state as InspectionState;

        // 2. Validate that inspection is in completed state (Req 8.5)
        if (currentState !== "completed") {
          throw new NonRetryableError(
            `Cannot submit for review: inspection is in '${currentState}' state, must be 'completed'`,
          );
        }

        // 3. Validate transition via state machine
        try {
          assertValidTransition(currentState, "under_review");
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // 4. Assign reviewer and transition to under_review (Req 8.5)
        const updated = await updateInspectionState(
          tx,
          p.inspectionId,
          msg.tenantId,
          "under_review",
          msg.actorId,
          { reviewerId: p.reviewerId },
        );

        inspectionId = updated.id;

        // 5. Record transition history (Req 8.8)
        await insertHistory(tx, {
          tenantId: msg.tenantId,
          inspectionId: p.inspectionId,
          previousState: currentState,
          newState: "under_review",
          actorId: msg.actorId,
          remarks: `Submitted for review to ${p.reviewerId}`,
        });

        // 6. Notify reviewer (Req 8.5)
        await enqueue(tx, {
          topic: NOTIFICATION_TOPIC,
          eventType: NOTIFICATION_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            type: "inspection.submitted_for_review",
            recipientIds: [p.reviewerId],
            data: {
              inspectionId: p.inspectionId,
              entityId: updated.entityId,
              submittedBy: msg.actorId,
            },
          },
        });

        // 7. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "inspection.submitted_review",
            resourceType: "inspection",
            resourceId: p.inspectionId,
            details: {
              reviewerId: p.reviewerId,
              previousState: currentState,
              newState: "under_review",
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (inspectionId) {
        try {
          await cache.invalidate(cache.makeKey(msg.tenantId, "inspection", inspectionId));
        } catch (err) {
          log.warn({ err, tenantId: msg.tenantId, inspectionId, event: "cache_invalidate_failed" },
            "failed to invalidate inspection cache after submit-review");
        }
      }
    },
  );

  // ─── inspectionFinalize ───────────────────────────────────────────────────
  queue.subscribe<InspectionFinalizePayload & { tenantId: string }>(
    COMMANDS.inspectionFinalize,
    async (msg) => {
      const p = msg.payload;
      let inspectionId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Load current inspection
        const inspection = await findInspectionById(msg.tenantId, p.inspectionId);
        if (!inspection) {
          throw new NonRetryableError(
            `Inspection not found: ${p.inspectionId} (tenant: ${msg.tenantId})`,
          );
        }

        const currentState = inspection.state as InspectionState;

        // 2. Validate that inspection is in under_review state
        if (currentState !== "under_review") {
          throw new NonRetryableError(
            `Cannot finalize: inspection is in '${currentState}' state, must be 'under_review'`,
          );
        }

        // 3. Validate transition via state machine
        try {
          assertValidTransition(currentState, "finalized");
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // 4. Generate report reference (Req 8.6)
        const reportS3Key = `reports/${msg.tenantId}/${p.inspectionId}/${randomUUID()}.pdf`;
        const now = new Date();

        // 5. Lock data and transition to finalized (Req 8.6)
        const updated = await updateInspectionState(
          tx,
          p.inspectionId,
          msg.tenantId,
          "finalized",
          msg.actorId,
          { finalizedAt: now, reportS3Key },
        );

        inspectionId = updated.id;

        // 6. Record transition history (Req 8.8)
        await insertHistory(tx, {
          tenantId: msg.tenantId,
          inspectionId: p.inspectionId,
          previousState: currentState,
          newState: "finalized",
          actorId: msg.actorId,
          remarks: "Inspection finalized — data locked",
        });

        // 7. Domain event: inspection finalized
        await enqueue(tx, {
          topic: EVENTS.inspectionFinalized,
          eventType: EVENTS.inspectionFinalized,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            inspectionId: p.inspectionId,
            entityId: updated.entityId,
            finalizedBy: msg.actorId,
            finalizedAt: now.toISOString(),
            reportRef: reportS3Key,
          },
        });

        // 8. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "inspection.finalized",
            resourceType: "inspection",
            resourceId: p.inspectionId,
            details: {
              previousState: currentState,
              newState: "finalized",
              reportS3Key,
              finalizedAt: now.toISOString(),
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (inspectionId) {
        try {
          await cache.invalidate(cache.makeKey(msg.tenantId, "inspection", inspectionId));
        } catch (err) {
          log.warn({ err, tenantId: msg.tenantId, inspectionId, event: "cache_invalidate_failed" },
            "failed to invalidate inspection cache after finalize");
        }
      }
    },
  );
}
