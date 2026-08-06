/**
 * winback/consumer.ts — Command consumers for the win-back cadence engine.
 *
 * Each handler: markProcessed → business write → outbox event → cache invalidate.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { advanceStep, canCancel, recordOutcome as domainRecordOutcome } from "./domain.js";
import * as repo from "./repo.js";
import { invalidateCadences, invalidateEnrollments, CADENCE_RESOURCE, ENROLLMENT_RESOURCE } from "./queries.js";
import { winbackCadences, winbackEnrollments } from "./schema.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "crm-winback-consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

export function registerWinbackConsumers(queue: Queue): void {
  // ── Create cadence ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.createWinbackCadence, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    if (!p?.id) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const view = await repo.insertCadence(tx as unknown as repo.Writer, {
          id: p.id as string,
          tenantId: msg.tenantId,
          name: p.name as string,
          triggerCriteria: p.triggerCriteria as unknown as import("./schema.js").TriggerCriteria,
          steps: p.steps as unknown as import("./schema.js").CadenceStep[],
          status: (p.status as string) ?? "draft",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.winbackCadenceCreated,
          action: "create",
          resourceType: CADENCE_RESOURCE,
          resourceId: view.id,
          payload: { cadenceId: view.id, name: view.name, status: view.status },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createWinbackCadence failed");
      throw err;
    }

    await invalidateCadences(msg.tenantId);
  });

  // ── Update cadence ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.updateWinbackCadence, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    if (!p?.id) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const changes: Record<string, unknown> = { updatedBy: msg.actorId };
        if (p.name !== undefined) changes.name = p.name;
        if (p.triggerCriteria !== undefined) changes.triggerCriteria = p.triggerCriteria;
        if (p.steps !== undefined) changes.steps = p.steps;
        if (p.status !== undefined) changes.status = p.status;

        const view = await repo.updateCadence(
          tx as unknown as repo.Writer,
          msg.tenantId,
          p.id as string,
          (p.version as number) ?? 1,
          changes,
        );

        if (!view) {
          log.warn({ id: p.id, version: p.version }, "winback cadence version conflict or not found");
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.winbackCadenceUpdated,
          action: "update",
          resourceType: CADENCE_RESOURCE,
          resourceId: view.id,
          payload: { cadenceId: view.id, status: view.status, version: view.version },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateWinbackCadence failed");
      throw err;
    }

    await invalidateCadences(msg.tenantId);
  });

  // ── Enroll account ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.enrollWinbackAccount, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    if (!p?.cadenceId || !p?.accountId) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const view = await repo.insertEnrollment(tx as unknown as repo.Writer, {
          id: (p.id as string) ?? randomUUID(),
          tenantId: msg.tenantId,
          cadenceId: p.cadenceId as string,
          accountId: p.accountId as string,
          currentStep: 0,
          status: "active",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.winbackAccountEnrolled,
          action: "enroll",
          resourceType: ENROLLMENT_RESOURCE,
          resourceId: view.id,
          payload: { enrollmentId: view.id, cadenceId: view.cadenceId, accountId: view.accountId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "enrollWinbackAccount failed");
      throw err;
    }

    await invalidateEnrollments(msg.tenantId);
  });

  // ── Advance step ────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.advanceWinbackStep, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    if (!p?.enrollmentId) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Read enrollment within transaction for consistency
        const [enrollment] = await (tx as unknown as repo.Writer)
          .select()
          .from(winbackEnrollments)
          .where(
            and(
              eq(winbackEnrollments.id, p.enrollmentId as string),
              eq(winbackEnrollments.tenantId, msg.tenantId),
              eq(winbackEnrollments.version, (p.version as number) ?? 1),
            ),
          )
          .limit(1);

        if (!enrollment) {
          log.warn({ enrollmentId: p.enrollmentId }, "enrollment not found or version mismatch");
          return;
        }

        if (enrollment.status !== "active") return;

        // Load cadence steps
        const [cadence] = await (tx as unknown as repo.Writer)
          .select()
          .from(winbackCadences)
          .where(eq(winbackCadences.id, enrollment.cadenceId))
          .limit(1);

        if (!cadence) return;

        const steps = (cadence.steps ?? []) as { ordinal: number; delayDays: number; actionType: string; templateRef?: string }[];
        const result = advanceStep(enrollment.currentStep, steps);

        if (result.completed) {
          await repo.updateEnrollment(
            tx as unknown as repo.Writer,
            msg.tenantId,
            enrollment.id,
            enrollment.version,
            { status: "completed", updatedBy: msg.actorId },
          );

          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.winbackEnrollmentCompleted,
            action: "complete",
            resourceType: ENROLLMENT_RESOURCE,
            resourceId: enrollment.id,
            payload: { enrollmentId: enrollment.id, cadenceId: enrollment.cadenceId },
          });
        } else {
          await repo.updateEnrollment(
            tx as unknown as repo.Writer,
            msg.tenantId,
            enrollment.id,
            enrollment.version,
            { currentStep: result.nextStep!, updatedBy: msg.actorId },
          );

          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.winbackStepAdvanced,
            action: "advance",
            resourceType: ENROLLMENT_RESOURCE,
            resourceId: enrollment.id,
            payload: {
              enrollmentId: enrollment.id,
              step: result.nextStep,
              actionType: result.scheduledAction?.actionType,
            },
          });
        }
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "advanceWinbackStep failed");
      throw err;
    }

    await invalidateEnrollments(msg.tenantId);
  });

  // ── Cancel enrollment ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.cancelWinbackEnrollment, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    if (!p?.enrollmentId) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const [enrollment] = await (tx as unknown as repo.Writer)
          .select()
          .from(winbackEnrollments)
          .where(
            and(
              eq(winbackEnrollments.id, p.enrollmentId as string),
              eq(winbackEnrollments.tenantId, msg.tenantId),
              eq(winbackEnrollments.version, (p.version as number) ?? 1),
            ),
          )
          .limit(1);

        if (!enrollment || !canCancel(enrollment.status)) return;

        await repo.updateEnrollment(
          tx as unknown as repo.Writer,
          msg.tenantId,
          enrollment.id,
          enrollment.version,
          { status: "cancelled", updatedBy: msg.actorId },
        );

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.winbackEnrollmentCancelled,
          action: "cancel",
          resourceType: ENROLLMENT_RESOURCE,
          resourceId: enrollment.id,
          payload: { enrollmentId: enrollment.id },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "cancelWinbackEnrollment failed");
      throw err;
    }

    await invalidateEnrollments(msg.tenantId);
  });

  // ── Record outcome ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.recordWinbackOutcome, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    if (!p?.enrollmentId || !p?.outcome) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const [enrollment] = await (tx as unknown as repo.Writer)
          .select()
          .from(winbackEnrollments)
          .where(
            and(
              eq(winbackEnrollments.id, p.enrollmentId as string),
              eq(winbackEnrollments.tenantId, msg.tenantId),
              eq(winbackEnrollments.version, (p.version as number) ?? 1),
            ),
          )
          .limit(1);

        if (!enrollment) return;

        const decision = domainRecordOutcome(enrollment.status, p.outcome as "converted" | "churned" | "no_response");
        if (!decision.valid) {
          log.warn({ enrollmentId: enrollment.id, reason: decision.reason }, "recordOutcome rejected");
          return;
        }

        const changes: Record<string, unknown> = {
          status: decision.newStatus,
          outcome: p.outcome,
          updatedBy: msg.actorId,
        };
        if (p.outcome === "converted") {
          changes.convertedAt = new Date();
        }

        await repo.updateEnrollment(
          tx as unknown as repo.Writer,
          msg.tenantId,
          enrollment.id,
          enrollment.version,
          changes,
        );

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.winbackOutcomeRecorded,
          action: "record_outcome",
          resourceType: ENROLLMENT_RESOURCE,
          resourceId: enrollment.id,
          payload: { enrollmentId: enrollment.id, outcome: p.outcome, newStatus: decision.newStatus },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "recordWinbackOutcome failed");
      throw err;
    }

    await invalidateEnrollments(msg.tenantId);
  });
}
