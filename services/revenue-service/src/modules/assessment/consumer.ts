/**
 * Assessment module — queue consumers (command handlers).
 *
 * Pattern: markProcessed → db.transaction → enqueue outbox + audit → cache.invalidate
 *
 * _Requirements: SVC-131, Requirement 7_
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { assessments, demands, dcbEntries, remissions } from "./schema.js";
import { rateSlabs, penaltyRules, rebateRules } from "../rate-engine/schema.js";
import { compute } from "../rate-engine/domain.js";
import { assertCanRevise, assertMakerChecker } from "./domain.js";
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
      const computeResult = compute(
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
      );

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

      if (!existing) {
        throw new Error(`Assessment ${assessmentId} not found`);
      }

      // Assert can revise (status must be active)
      assertCanRevise(existing.status);

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
        throw new Error(`Version conflict on assessment ${assessmentId}`);
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
      const computeResult = compute(
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
      );

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

      // Insert remission in pending status
      await tx.insert(remissions).values({
        tenantId: msg.tenantId,
        assessmentId,
        reason,
        remissionPercent,
        status: "pending",
        makerUserId: msg.actorId,
      });

      // Audit event
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "remit",
          resourceType: "assessment",
          resourceId: assessmentId,
          outcome: "success",
        },
      });
    });
  });

  // ── assessmentRemitDecide ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.assessmentRemitDecide, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assessmentId, approve, reason } = msg.payload as {
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

      // Audit event
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "remit_decide",
          resourceType: "assessment",
          resourceId: assessmentId,
          outcome: newStatus,
        },
      });
    });

    // Invalidate cache
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessments`);
  });
}
