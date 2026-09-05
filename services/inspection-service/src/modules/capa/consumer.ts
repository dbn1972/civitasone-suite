/**
 * inspection-service: CAPA module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * _Requirements: SVC-106_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache, invalidateSafely } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  assertValidCapaTransition,
  assertMakerCheckerForVerification,
  validateEffectivenessEvidence,
  DomainError,
  type CapaState,
} from "./domain.js";
import { insertCapa, updateCapa, findCapaById } from "./repo.js";
import type {
  CapaCreatePayload,
  CapaUpdatePayload,
  CapaStartPayload,
  CapaCompletePayload,
  CapaVerifyPayload,
  CapaTriggerReinspectionPayload,
} from "./commands.js";

const log = pino({ name: "capa-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerCapaConsumers(queue: Queue): void {
  // ─── capaCreate ───────────────────────────────────────────────────────────
  queue.subscribe<CapaCreatePayload & { tenantId: string }>(
    COMMANDS.capaCreate,
    async (msg) => {
      const p = msg.payload;
      let capaId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const capa = await insertCapa(tx, {
          tenantId: msg.tenantId,
          findingId: p.findingId,
          type: p.type,
          description: p.description,
          ownerId: p.ownerId ?? null,
          dueDate: p.dueDate ?? null,
          status: "open",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        capaId = capa.id;

        await enqueue(tx, {
          topic: EVENTS.capaCreated,
          eventType: EVENTS.capaCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            capaId: capa.id,
            findingId: capa.findingId,
            type: capa.type,
            ownerId: capa.ownerId,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "capa.created",
            resourceType: "corrective_action",
            resourceId: capa.id,
            details: { findingId: p.findingId, type: p.type },
          },
        });
      });

      if (capaId) {
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "capa", capaId), log,
          { tenantId: msg.tenantId, capaId }, "failed to invalidate capa cache after create",
        );
      }
    },
  );

  // ─── capaUpdate ───────────────────────────────────────────────────────────
  queue.subscribe<CapaUpdatePayload & { tenantId: string }>(
    COMMANDS.capaUpdate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const patch: Record<string, unknown> = { updatedBy: msg.actorId };
        if (p.ownerId !== undefined) patch.ownerId = p.ownerId;
        if (p.dueDate !== undefined) patch.dueDate = p.dueDate;
        if (p.description !== undefined) patch.description = p.description;

        await updateCapa(tx, p.capaId, msg.tenantId, patch, p.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "capa.updated",
            resourceType: "corrective_action",
            resourceId: p.capaId,
            details: { changedFields: Object.keys(patch) },
          },
        });
      });

      await invalidateSafely(
        cache.makeKey(msg.tenantId, "capa", p.capaId), log,
        { tenantId: msg.tenantId, capaId: p.capaId }, "failed to invalidate capa cache after update",
      );
    },
  );

  // ─── capaStart ────────────────────────────────────────────────────────────
  // Starts work on an open/overdue CAPA: open|overdue -> in_progress. This is
  // the missing precursor to capaComplete — CAPA_TRANSITIONS (domain.ts) has
  // no open -> completed edge by design (a CAPA must pass through in_progress
  // first, per the domain test "throws for open -> completed (must go through
  // in_progress)"), but before this handler existed nothing anywhere ever
  // performed the open -> in_progress transition. Every CAPA was created via
  // capaCreate with status "open" and stayed there permanently: /complete
  // always threw INVALID_TRANSITION, silently, because the 202-accepted HTTP
  // response had already been sent before this consumer ever ran.
  queue.subscribe<CapaStartPayload & { tenantId: string }>(
    COMMANDS.capaStart,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const capa = await findCapaById(msg.tenantId, p.capaId);
        if (!capa) {
          throw new NonRetryableError(`CAPA not found: ${p.capaId} (tenant: ${msg.tenantId})`);
        }

        // Idempotent no-op: already at the target state (redelivery with a
        // different messageId, e.g. a client retry after a slow 202).
        if (capa.status === "in_progress") {
          return;
        }

        try {
          assertValidCapaTransition(capa.status as CapaState, "in_progress");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateCapa(tx, p.capaId, msg.tenantId, {
          status: "in_progress",
          updatedBy: msg.actorId,
        }, capa.version);

        await enqueue(tx, {
          topic: EVENTS.capaStarted,
          eventType: EVENTS.capaStarted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { capaId: p.capaId, startedBy: msg.actorId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "capa.started",
            resourceType: "corrective_action",
            resourceId: p.capaId,
            details: { previousStatus: capa.status },
          },
        });
      });

      await invalidateSafely(
        cache.makeKey(msg.tenantId, "capa", p.capaId), log,
        { tenantId: msg.tenantId, capaId: p.capaId }, "failed to invalidate capa cache after start",
      );
    },
  );

  // ─── capaComplete ─────────────────────────────────────────────────────────
  queue.subscribe<CapaCompletePayload & { tenantId: string }>(
    COMMANDS.capaComplete,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const capa = await findCapaById(msg.tenantId, p.capaId);
        if (!capa) {
          throw new NonRetryableError(`CAPA not found: ${p.capaId} (tenant: ${msg.tenantId})`);
        }

        try {
          assertValidCapaTransition(capa.status as CapaState, "completed");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        try {
          validateEffectivenessEvidence(p.evidenceOfClosure);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateCapa(tx, p.capaId, msg.tenantId, {
          status: "completed",
          evidenceOfClosure: p.evidenceOfClosure,
          closedAt: new Date(),
          closedBy: msg.actorId,
          updatedBy: msg.actorId,
        }, capa.version);

        await enqueue(tx, {
          topic: EVENTS.capaCompleted,
          eventType: EVENTS.capaCompleted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { capaId: p.capaId, completedBy: msg.actorId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "capa.completed",
            resourceType: "corrective_action",
            resourceId: p.capaId,
            details: { evidenceCount: p.evidenceOfClosure.length },
          },
        });
      });

      await invalidateSafely(
        cache.makeKey(msg.tenantId, "capa", p.capaId), log,
        { tenantId: msg.tenantId, capaId: p.capaId }, "failed to invalidate capa cache after complete",
      );
    },
  );

  // ─── capaVerify ───────────────────────────────────────────────────────────
  queue.subscribe<CapaVerifyPayload & { tenantId: string }>(
    COMMANDS.capaVerify,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const capa = await findCapaById(msg.tenantId, p.capaId);
        if (!capa) {
          throw new NonRetryableError(`CAPA not found: ${p.capaId} (tenant: ${msg.tenantId})`);
        }

        try {
          assertValidCapaTransition(capa.status as CapaState, "verified");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        // Maker-checker: verifier ≠ creator
        try {
          assertMakerCheckerForVerification(capa.createdBy, msg.actorId);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateCapa(tx, p.capaId, msg.tenantId, {
          status: "verified",
          effectivenessVerified: p.effectivenessVerified,
          verifiedBy: msg.actorId,
          verifiedAt: new Date(),
          updatedBy: msg.actorId,
        }, capa.version);

        await enqueue(tx, {
          topic: EVENTS.capaVerified,
          eventType: EVENTS.capaVerified,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { capaId: p.capaId, verifiedBy: msg.actorId, effectivenessVerified: p.effectivenessVerified },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "capa.verified",
            resourceType: "corrective_action",
            resourceId: p.capaId,
            details: { effectivenessVerified: p.effectivenessVerified },
          },
        });
      });

      await invalidateSafely(
        cache.makeKey(msg.tenantId, "capa", p.capaId), log,
        { tenantId: msg.tenantId, capaId: p.capaId }, "failed to invalidate capa cache after verify",
      );
    },
  );

  // ─── capaTriggerReinspection ──────────────────────────────────────────────
  queue.subscribe<CapaTriggerReinspectionPayload & { tenantId: string }>(
    COMMANDS.capaTriggerReinspection,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const capa = await findCapaById(msg.tenantId, p.capaId);
        if (!capa) {
          throw new NonRetryableError(`CAPA not found: ${p.capaId} (tenant: ${msg.tenantId})`);
        }

        await updateCapa(tx, p.capaId, msg.tenantId, {
          reInspectionTriggered: true,
          updatedBy: msg.actorId,
        }, capa.version);

        await enqueue(tx, {
          topic: EVENTS.capaReinspectionTriggered,
          eventType: EVENTS.capaReinspectionTriggered,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { capaId: p.capaId, findingId: capa.findingId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "capa.reinspection_triggered",
            resourceType: "corrective_action",
            resourceId: p.capaId,
            details: { findingId: capa.findingId },
          },
        });
      });

      await invalidateSafely(
        cache.makeKey(msg.tenantId, "capa", p.capaId), log,
        { tenantId: msg.tenantId, capaId: p.capaId }, "failed to invalidate capa cache after reinspection trigger",
      );
    },
  );
}
