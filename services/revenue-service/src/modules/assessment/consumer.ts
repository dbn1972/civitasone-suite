/**
 * Assessment module — queue consumers (command handlers).
 *
 * Pattern: markProcessed → db.transaction → enqueue outbox + audit → cache.invalidate
 *
 * _Requirements: SVC-131, Requirement 7_
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { enqueueAudit } from "../../shared/audit.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { assessments, demands, dcbEntries, remissions } from "./schema.js";
import { rateSlabs, penaltyRules, rebateRules } from "../rate-engine/schema.js";
import { compute } from "../rate-engine/domain.js";
import { assertCanRevise, assertMakerChecker, DomainError } from "./domain.js";
import { assessees } from "../assessee/schema.js";
import { rateHeads } from "../rate-engine/schema.js";

/**
 * UAT B9-F78: a business-rule rejection (DomainError) can never succeed on redelivery, so surface it
 * as NonRetryableError ("CODE: detail", original as cause): the queue logs it at error level,
 * records a 'rejected' outcome and dead-letters it once instead of retrying until the DLQ.
 */
function rejectOnDomainError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) throw new NonRetryableError(`${err.code}: ${err.message}`, err);
    throw err;
  }
}
import { eq, and } from "drizzle-orm";

export function registerAssessmentConsumers(queue: Queue): void {
  // ── assessmentCreate ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.assessmentCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assesseeId, rateHeadId, financialYear, baseValue, exemptions } = msg.payload as {
        assesseeId: string;
        rateHeadId: string;
        financialYear: string;
        baseValue: string;
        exemptions?: Array<{ type: string; amount: string }>;
      };

      // UAT B9-F78b: the route 422s first; this guards a direct or raced publish (RLS-scoped tx).
      // There is no FK, so without it an unknown assessee became an orphan assessment + demand.
      const [assessee] = await tx
        .select({ id: assessees.id })
        .from(assessees)
        .where(and(eq(assessees.tenantId, msg.tenantId), eq(assessees.id, assesseeId)))
        .limit(1);
      if (!assessee) throw new NonRetryableError("ASSESSEE_NOT_FOUND", `assessee ${assesseeId} not found`);
      const [rateHead] = await tx
        .select({ id: rateHeads.id })
        .from(rateHeads)
        .where(and(eq(rateHeads.tenantId, msg.tenantId), eq(rateHeads.id, rateHeadId)))
        .limit(1);
      if (!rateHead) throw new NonRetryableError("RATE_HEAD_NOT_FOUND", `rate head ${rateHeadId} not found`);

      // 1. Insert assessment
      const [assessment] = await tx.insert(assessments).values({
        tenantId: msg.tenantId,
        assesseeId,
        rateHeadId,
        financialYear,
        baseValue: BigInt(baseValue),
        exemptions: exemptions ?? [],
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }).returning();

      // 2. Load rate data from rate-engine tables
      const slabs = await tx
        .select()
        .from(rateSlabs)
        .where(and(eq(rateSlabs.tenantId, msg.tenantId), eq(rateSlabs.rateHeadId, rateHeadId)));

      const penalties = await tx
        .select()
        .from(penaltyRules)
        .where(and(eq(penaltyRules.tenantId, msg.tenantId), eq(penaltyRules.rateHeadId, rateHeadId)));

      const rebates = await tx
        .select()
        .from(rebateRules)
        .where(and(eq(rebateRules.tenantId, msg.tenantId), eq(rebateRules.rateHeadId, rateHeadId)));

      // 3. Compute demand via rate engine domain
      const today = new Date().toISOString().slice(0, 10);
      const dueDate = today; // default due date = today for new assessments
      const computeResult = rejectOnDomainError(() => compute(
        slabs as any,
        penalties as any,
        rebates as any,
        {
          rateHeadId,
          baseValue: BigInt(baseValue),
          asOfDate: today,
          dueDate,
          exemptions: (exemptions ?? []).map((e) => e.type),
        },
      ));

      // 4. Insert demand with compute snapshot
      const [demand] = await tx.insert(demands).values({
        tenantId: msg.tenantId,
        assesseeId,
        assessmentId: assessment!.id,
        rateHeadId,
        financialYear,
        dueDate,
        principalMinor: computeResult.principal,
        rebateMinor: computeResult.rebate,
        penaltyMinor: computeResult.penalty,
        interestMinor: computeResult.interest,
        netMinor: computeResult.net,
        computeSnapshot: computeResult.snapshot,
        status: "raised",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }).returning();

      // 5. Insert initial DCB entry (type: demand)
      await tx.insert(dcbEntries).values({
        tenantId: msg.tenantId,
        assesseeId,
        demandId: demand!.id,
        entryType: "demand",
        amountMinor: computeResult.net,
        balanceMinor: computeResult.net,
        narration: `Demand raised for assessment ${assessment!.id}`,
        createdBy: msg.actorId,
      });

      // 6. Enqueue domain event + audit
      await enqueue(tx, {
        topic: EVENTS.assessmentCreated,
        eventType: EVENTS.assessmentCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          assessmentId: assessment!.id,
          assesseeId,
          rateHeadId,
          financialYear,
          baseValue,
        },
      });
      await enqueue(tx, {
        topic: EVENTS.demandRaised,
        eventType: EVENTS.demandRaised,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          assessmentId: assessment!.id,
          demandId: demand!.id,
          assesseeId,
          netMinor: computeResult.net.toString(),
        },
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "create",
          resourceType: "assessment",
          resourceId: assessment!.id,
          demandId: demand!.id,
          outcome: "success",
        },
      });
    });

    // 7. Invalidate caches
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessments`);
    const { assesseeId } = msg.payload as { assesseeId: string };
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:demands:${assesseeId}`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assesseeId}`);
  });

  // ── assessmentRevise ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.assessmentRevise, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assessmentId, version, reason, newBaseValue, newExemptions } = msg.payload as {
        assessmentId: string;
        version: number;
        reason: string;
        newBaseValue: string;
        newExemptions?: Array<{ type: string; amount: string }>;
      };

      // Load existing assessment
      const [existing] = await tx
        .select()
        .from(assessments)
        .where(and(eq(assessments.tenantId, msg.tenantId), eq(assessments.id, assessmentId)));

      // UAT B9-F78a: was a plain (retryable) Error, so a 202'd revise of an unknown id looped to the DLQ.
      if (!existing) {
        throw new NonRetryableError("NOT_FOUND", `assessment ${assessmentId} not found`);
      }

      // Assert can revise (status must be active)
      rejectOnDomainError(() => assertCanRevise(existing.status));

      // Update assessment with optimistic lock
      const [updated] = await tx
        .update(assessments)
        .set({
          baseValue: BigInt(newBaseValue),
          exemptions: newExemptions ?? existing.exemptions,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: existing.version + 1,
        })
        .where(and(eq(assessments.id, assessmentId), eq(assessments.version, version)))
        .returning();

      if (!updated) {
        throw new NonRetryableError("VERSION_CONFLICT", `version conflict on assessment ${assessmentId}`);
      }

      // Recompute demand
      const slabs = await tx
        .select()
        .from(rateSlabs)
        .where(and(eq(rateSlabs.tenantId, msg.tenantId), eq(rateSlabs.rateHeadId, existing.rateHeadId)));

      const penalties = await tx
        .select()
        .from(penaltyRules)
        .where(and(eq(penaltyRules.tenantId, msg.tenantId), eq(penaltyRules.rateHeadId, existing.rateHeadId)));

      const rebates = await tx
        .select()
        .from(rebateRules)
        .where(and(eq(rebateRules.tenantId, msg.tenantId), eq(rebateRules.rateHeadId, existing.rateHeadId)));

      const today = new Date().toISOString().slice(0, 10);
      const computeResult = rejectOnDomainError(() => compute(
        slabs as any,
        penalties as any,
        rebates as any,
        {
          rateHeadId: existing.rateHeadId,
          baseValue: BigInt(newBaseValue),
          asOfDate: today,
          dueDate: today,
          exemptions: (newExemptions ?? (existing.exemptions as any[]) ?? []).map((e: any) => e.type ?? e),
        },
      ));

      // Update existing demand
      await tx
        .update(demands)
        .set({
          principalMinor: computeResult.principal,
          rebateMinor: computeResult.rebate,
          penaltyMinor: computeResult.penalty,
          interestMinor: computeResult.interest,
          netMinor: computeResult.net,
          computeSnapshot: computeResult.snapshot,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        })
        .where(and(eq(demands.tenantId, msg.tenantId), eq(demands.assessmentId, assessmentId)));

      // Enqueue event + audit
      await enqueue(tx, {
        topic: EVENTS.assessmentRevised,
        eventType: EVENTS.assessmentRevised,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { assessmentId, reason, newBaseValue },
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "revise",
          resourceType: "assessment",
          resourceId: assessmentId,
          outcome: "success",
        },
      });
    });

    // Invalidate caches
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessments`);
    const { assessmentId } = msg.payload as { assessmentId: string };
    // Look up assessee for cache invalidation (best-effort)
    const assessment = await db
      .select()
      .from(assessments)
      .where(and(eq(assessments.tenantId, msg.tenantId), eq(assessments.id, assessmentId)));
    if (assessment[0]) {
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:demands:${assessment[0].assesseeId}`);
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assessment[0].assesseeId}`);
    }
  });

  // ── assessmentRemit ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.assessmentRemit, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assessmentId, reason, remissionPercent } = msg.payload as {
        assessmentId: string;
        reason: string;
        remissionPercent: number;
      };

      // UAT B8-F68 (P1): never write an orphan remission. The route 404s first; this guards a
      // direct or raced publish (the tx runs in the tenant context, so the read is RLS-scoped).
      const [target] = await tx
        .select({ id: assessments.id })
        .from(assessments)
        .where(and(eq(assessments.tenantId, msg.tenantId), eq(assessments.id, assessmentId)))
        .limit(1);
      if (!target) throw new NonRetryableError("NOT_FOUND", `assessment ${assessmentId} not found`);

      // Insert remission in pending status
      const [remission] = await tx.insert(remissions).values({
        tenantId: msg.tenantId,
        assessmentId,
        reason,
        remissionPercent,
        status: "pending",
        makerUserId: msg.actorId,
      }).returning({ id: remissions.id });

      // UAT B10-F86: the remission itself is the audited resource (it was the
      // assessment, so no audit event ever targeted a remission row).
      await enqueueAudit(tx, msg, {
        action: "remit",
        resourceType: "remission",
        resourceId: remission!.id,
        outcome: "pending",
        assessmentId,
        remissionPercent,
      });
    });
  });

  // ── assessmentRemitDecide ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.assessmentRemitDecide, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assessmentId, approve } = msg.payload as {
        assessmentId: string;
        approve: boolean;
        reason?: string;
      };

      // Find the pending remission
      const [remission] = await tx
        .select()
        .from(remissions)
        .where(
          and(
            eq(remissions.tenantId, msg.tenantId),
            eq(remissions.assessmentId, assessmentId),
            eq(remissions.status, "pending"),
          ),
        );

      if (!remission) {
        throw new Error(`No pending remission found for assessment ${assessmentId}`);
      }

      // Enforce maker-checker: decider must differ from maker
      assertMakerChecker(remission.makerUserId, msg.actorId);

      // Update remission status
      const newStatus = approve ? "approved" : "rejected";
      await tx
        .update(remissions)
        .set({
          status: newStatus,
          checkerUserId: msg.actorId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(remissions.id, remission.id));

      // If approved, enqueue domain event
      if (approve) {
        await enqueue(tx, {
          topic: EVENTS.assessmentRemitted,
          eventType: EVENTS.assessmentRemitted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { assessmentId, remissionId: remission.id },
        });
      }

      // UAT B10-F86: audit the decided remission (maker and checker are on the row).
      await enqueueAudit(tx, msg, {
        action: "remit_decide",
        resourceType: "remission",
        resourceId: remission.id,
        outcome: newStatus,
        assessmentId,
        remissionPercent: remission.remissionPercent,
        makerUserId: remission.makerUserId,
      });
    });

    // Invalidate cache
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessments`);
  });
}
