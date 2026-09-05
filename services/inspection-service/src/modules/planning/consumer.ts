/**
 * inspection-service: planning module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * Plan lifecycle: draft → pending_approval → active
 *
 * Handles:
 *   - planCreate: insert new plan in draft status
 *   - planModify: assert plan is draft → update fields (optimistic lock)
 *   - planSubmitApproval: transition to pending_approval → publish workflow.command.submit
 *   - planActivate: transition to active → emit planApproved event
 *   - CONSUMED_EVENTS.planApprovalDecided: approved → publish planActivate; rejected → back to draft
 *
 * _Requirements: 3.4, 3.5, 3.6, 3.7_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache, invalidateSafely } from "../../shared/infra.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { insertPlan, updatePlan, findPlanById } from "./repo.js";
import { submitPlanForWorkflowApproval } from "./commands.js";
import type {
  PlanCreatePayload,
  PlanModifyPayload,
  PlanSubmitApprovalPayload,
  PlanActivatePayload,
} from "./commands.js";

const log = pino({ name: "planning-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Consumed event payload types ──────────────────────────────────────────────

interface PlanApprovalDecidedPayload {
  workflowInstanceId: string;
  entityType: string;
  entityId: string;
  outcome: "approved" | "rejected";
  actorId: string;
  decidedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Assert a plan is in draft status (modifiable). Throws NonRetryableError otherwise.
 */
function assertPlanModifiable(status: string, planId: string): void {
  if (status !== "draft") {
    throw new NonRetryableError(
      `Plan ${planId} is in '${status}' state and cannot be modified. Only draft plans are editable.`,
    );
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerPlanningConsumers(queue: Queue): void {
  // ─── planCreate ───────────────────────────────────────────────────────
  queue.subscribe<PlanCreatePayload>(COMMANDS.planCreate, async (msg) => {
    const p = msg.payload;
    let planId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const plan = await insertPlan(tx, {
        tenantId: msg.tenantId,
        name: p.name,
        description: p.description ?? null,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        status: "draft",
        riskThreshold: p.riskThreshold ?? null,
        selectionCriteria: p.selectionCriteria ?? null,
        entityIds: p.entityIds,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      planId = plan.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "plan.created",
          resourceType: "inspection_plan",
          resourceId: plan.id,
          details: { name: plan.name, periodStart: plan.periodStart, periodEnd: plan.periodEnd },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (planId) {
      await invalidateSafely(
        cache.makeKey(msg.tenantId, "plan", planId), log,
        { tenantId: msg.tenantId, planId }, "failed to invalidate plan cache after create",
      );
    }
  });

  // ─── planModify ───────────────────────────────────────────────────────
  queue.subscribe<PlanModifyPayload>(COMMANDS.planModify, async (msg) => {
    const p = msg.payload;
    let updatedPlanId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Look up the plan to check state
      const existing = await findPlanById(msg.tenantId, p.planId);
      if (!existing) {
        throw new NonRetryableError(`Plan ${p.planId} not found for tenant ${msg.tenantId}`);
      }

      // Only draft plans can be modified
      assertPlanModifiable(existing.status, p.planId);

      // Optimistic locking update
      let plan;
      try {
        plan = await updatePlan(tx, p.planId, p.version, {
          ...p.patch,
          updatedBy: msg.actorId,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      updatedPlanId = plan.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "plan.modified",
          resourceType: "inspection_plan",
          resourceId: plan.id,
          details: { version: plan.version, changedFields: Object.keys(p.patch) },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (updatedPlanId) {
      await invalidateSafely(
        cache.makeKey(msg.tenantId, "plan", updatedPlanId), log,
        { tenantId: msg.tenantId, planId: updatedPlanId }, "failed to invalidate plan cache after modify",
      );
    }
  });

  // ─── planSubmitApproval ───────────────────────────────────────────────
  queue.subscribe<PlanSubmitApprovalPayload>(COMMANDS.planSubmitApproval, async (msg) => {
    const p = msg.payload;
    let submittedPlanId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Look up the plan to check state
      const existing = await findPlanById(msg.tenantId, p.planId);
      if (!existing) {
        throw new NonRetryableError(`Plan ${p.planId} not found for tenant ${msg.tenantId}`);
      }

      // Only draft plans can be submitted for approval
      assertPlanModifiable(existing.status, p.planId);

      // Transition to pending_approval
      let plan;
      try {
        plan = await updatePlan(tx, p.planId, p.version, {
          status: "pending_approval",
          updatedBy: msg.actorId,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      submittedPlanId = plan.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "plan.submitted_for_approval",
          resourceType: "inspection_plan",
          resourceId: plan.id,
          details: { version: plan.version },
        },
      });
    });

    // Publish workflow submission (outside transaction — cross-service command)
    if (submittedPlanId) {
      await submitPlanForWorkflowApproval(
        { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as import("@civitasone/types").RequestContext,
        submittedPlanId,
      );

      // Cache invalidation (best-effort)
      await invalidateSafely(
        cache.makeKey(msg.tenantId, "plan", submittedPlanId), log,
        { tenantId: msg.tenantId, planId: submittedPlanId }, "failed to invalidate plan cache after submit",
      );
    }
  });

  // ─── planActivate ─────────────────────────────────────────────────────
  queue.subscribe<PlanActivatePayload>(COMMANDS.planActivate, async (msg) => {
    const p = msg.payload;
    let activatedPlanId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Look up the plan to check state
      const existing = await findPlanById(msg.tenantId, p.planId);
      if (!existing) {
        throw new NonRetryableError(`Plan ${p.planId} not found for tenant ${msg.tenantId}`);
      }

      if (existing.status !== "pending_approval") {
        throw new NonRetryableError(
          `Plan ${p.planId} is in '${existing.status}' state and cannot be activated. Only pending_approval plans can be activated.`,
        );
      }

      // Transition to active
      let plan;
      try {
        plan = await updatePlan(tx, p.planId, p.version, {
          status: "active",
          approvedAt: new Date(),
          approvedBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      activatedPlanId = plan.id;

      // Emit planApproved domain event
      await enqueue(tx, {
        topic: EVENTS.planApproved,
        eventType: EVENTS.planApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          planId: plan.id,
          name: plan.name,
          period: { start: plan.periodStart, end: plan.periodEnd },
          approvedBy: msg.actorId,
          approvedAt: plan.approvedAt?.toISOString() ?? new Date().toISOString(),
        },
      });

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "plan.activated",
          resourceType: "inspection_plan",
          resourceId: plan.id,
          details: { version: plan.version },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (activatedPlanId) {
      await invalidateSafely(
        cache.makeKey(msg.tenantId, "plan", activatedPlanId), log,
        { tenantId: msg.tenantId, planId: activatedPlanId }, "failed to invalidate plan cache after activate",
      );
    }
  });

  // ─── planApprovalDecided (CONSUMED EVENT from workflow-service) ────────
  queue.subscribe<PlanApprovalDecidedPayload>(CONSUMED_EVENTS.planApprovalDecided, async (msg) => {
    const p = msg.payload;

    if (p.entityType !== "inspection_plan") {
      log.info(
        { event: "plan_approval_decided_skipped", entityType: p.entityType, entityId: p.entityId },
        "skipping non-plan approval decision",
      );
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const existing = await findPlanById(msg.tenantId, p.entityId);
      if (!existing) {
        throw new NonRetryableError(`Plan ${p.entityId} not found for tenant ${msg.tenantId}`);
      }

      if (existing.status !== "pending_approval") {
        log.warn(
          { event: "plan_approval_decided_unexpected_state", planId: p.entityId, status: existing.status },
          "plan is not in pending_approval state; skipping transition",
        );
        return;
      }

      if (p.outcome === "approved") {
        // Transition to active via planActivate command (maintains single-writer)
        await enqueue(tx, {
          topic: COMMANDS.planActivate,
          eventType: COMMANDS.planActivate,
          tenantId: msg.tenantId,
          actorId: p.actorId,
          correlationId: msg.correlationId,
          payload: {
            planId: p.entityId,
            version: existing.version,
          },
        });

        // Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: p.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "plan.approval_decided",
            resourceType: "inspection_plan",
            resourceId: p.entityId,
            details: { outcome: "approved", decidedAt: p.decidedAt },
          },
        });
      } else {
        // Rejected: transition back to draft
        try {
          await updatePlan(tx, p.entityId, existing.version, {
            status: "draft",
            workflowInstanceId: null,
            updatedBy: p.actorId,
          });
        } catch (err: unknown) {
          if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: p.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "plan.approval_decided",
            resourceType: "inspection_plan",
            resourceId: p.entityId,
            details: { outcome: "rejected", decidedAt: p.decidedAt },
          },
        });

        // Cache invalidation for rejected plan
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "plan", p.entityId), log,
          { tenantId: msg.tenantId, planId: p.entityId }, "failed to invalidate plan cache after rejection",
        );
      }
    });
  });
}
