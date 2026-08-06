/**
 * G15 — MoU milestone governance consumers.
 *
 * Every handler is exactly ONE transaction, shaped:
 *   1. markProcessed(tx, msg.messageId)  ← FIRST statement; false ⇒ redelivery, return
 *   2. Postgres writes
 *   3. enqueue outbox events (domain + audit)
 *   4. (after commit) cache invalidation
 *
 * Double-count safety on penalties is belt AND braces:
 *   - the inbox (markProcessed) stops the same messageId being processed twice;
 *   - UNIQUE (tenant_id, penalty_term_id, occurrence_key) on
 *     mou.penalty_applications stops the same OCCURRENCE being charged twice
 *     even under a different messageId (operator double-click, replay, retry
 *     with a fresh id). The database, not the application, is the authority.
 *
 * Every duplicate-business-key insert uses onConflictDoNothing + returning()
 * rather than try/catch on the 23505 error code. Catching a unique violation
 * cannot work here: postgres.js records the first failed statement in a
 * transaction and rethrows it after the callback returns (src/index.js
 * `uncaughtError`), which is the only correct thing it can do — Postgres has
 * already aborted the transaction, so no later statement in it could commit.
 * A caught-and-ignored violation therefore still rolls back the inbox row and
 * dead-letters the message. onConflictDoNothing never raises, so the duplicate
 * is a genuine clean no-op: nothing written, no event emitted, message acked.
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { contractMilestones } from "../contracts/schema.js";
import { penaltyTerms, penaltyApplications, reviewSchedules } from "./schema.js";
import {
  canTransition,
  assertWaiverAllowed,
  computePenalty,
  occurrenceKey,
  nextReviewDate,
  daysOverdue,
  type PenaltyKind,
} from "./domain.js";

const log = pino({ name: "contract-mou-consumer" });

const AUDIT_TOPIC = "audit.event.record";

type Tx = Parameters<typeof enqueue>[0];

interface MsgLike {
  messageId: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: unknown;
}

async function audit(tx: Tx, msg: MsgLike, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType, resourceId, outcome: "success" },
  });
}

function emit(tx: Tx, msg: MsgLike, topic: string, payload: Record<string, unknown>): Promise<unknown> {
  return enqueue(tx, {
    topic,
    eventType: topic,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

function toBigIntOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  // Strings only — a JSON number would already have lost precision above 2^53.
  return BigInt(String(v));
}

export function registerMouMilestoneConsumers(q: Queue): void {
  // ══ Register a milestone ═════════════════════════════════════════════════
  q.subscribe(COMMANDS.mouMilestoneRegister, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string; milestoneCode: string;
      name: string; description: string; dueDate: string; ordinal: number;
      amountMinor: string | null; currency: string;
    };
    const amountMinor = toBigIntOrNull(p.amountMinor) ?? 0n;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // uq_contract_milestones_code is a PARTIAL unique index (…WHERE
      // milestone_code IS NOT NULL), so the ON CONFLICT clause has to repeat
      // that predicate for Postgres to infer the index.
      const inserted = await tx
        .insert(contractMilestones)
        .values({
          id: p.id,
          tenantId: msg.tenantId,
          contractId: p.contractId,
          milestoneCode: p.milestoneCode,
          title: p.name,
          description: p.description,
          dueDate: p.dueDate,
          ordinal: p.ordinal,
          amountMinor,
          currency: p.currency,
          status: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })
        .onConflictDoNothing({
          target: [contractMilestones.tenantId, contractMilestones.contractId, contractMilestones.milestoneCode],
          where: isNotNull(contractMilestones.milestoneCode),
        })
        .returning({ id: contractMilestones.id });

      if (inserted.length === 0) {
        // This milestone_code is already registered on this contract.
        // Registering it again would create a second payment milestone for the
        // same deliverable.
        log.warn(
          { event: "duplicate_milestone_code", messageId: msg.messageId, tenantId: msg.tenantId, contractId: p.contractId },
          "milestone code already registered for this contract — skipping",
        );
        return;
      }

      await emit(tx, msg, EVENTS.mouMilestoneRegistered, {
        id: p.id,
        tenantId: msg.tenantId,
        contractId: p.contractId,
        milestoneCode: p.milestoneCode,
        name: p.name,
        dueDate: p.dueDate,
        ordinal: p.ordinal,
        amountMinor: p.amountMinor,
        currency: p.currency,
      });
      await audit(tx, msg, "mou_milestone_register", "mou_milestone", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "mou-milestone", p.id));
  });

  // ══ Transition a milestone ═══════════════════════════════════════════════
  q.subscribe(COMMANDS.mouMilestoneTransition, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string; version: number;
      toStatus: "met" | "missed" | "waived"; completedAt?: string; waiverReason?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [existing] = await tx
        .select()
        .from(contractMilestones)
        .where(and(eq(contractMilestones.id, p.id), eq(contractMilestones.tenantId, msg.tenantId)))
        .limit(1);
      if (!existing) {
        log.warn({ event: "milestone_not_found", messageId: msg.messageId, tenantId: msg.tenantId }, "milestone transition skipped");
        return;
      }

      if (!canTransition(existing.status, p.toStatus)) {
        log.warn(
          { event: "invalid_transition", messageId: msg.messageId, tenantId: msg.tenantId, from: existing.status, to: p.toStatus },
          "milestone transition rejected by state machine",
        );
        return;
      }

      const now = new Date();
      const updates: Record<string, unknown> = {
        status: p.toStatus,
        updatedBy: msg.actorId,
        updatedAt: now,
        version: p.version + 1,
      };

      if (p.toStatus === "met") {
        const completedAt = p.completedAt ? new Date(p.completedAt) : now;
        updates.completedAt = completedAt;
        updates.achievedDate = completedAt.toISOString().slice(0, 10);
      }
      if (p.toStatus === "waived") {
        // Throws unless an actor and a reason are both present — the same rule
        // the contract_milestones_waiver_complete_check constraint enforces.
        assertWaiverAllowed(existing.status, { waivedBy: msg.actorId, reason: p.waiverReason ?? "" });
        updates.waivedBy = msg.actorId;
        updates.waivedAt = now;
        updates.waiverReason = p.waiverReason;
      }

      // Optimistic lock: no row updated ⇒ someone else moved first.
      const updated = await tx
        .update(contractMilestones)
        .set(updates as Partial<typeof contractMilestones.$inferInsert>)
        .where(
          and(
            eq(contractMilestones.id, p.id),
            eq(contractMilestones.tenantId, msg.tenantId),
            eq(contractMilestones.version, p.version),
          ),
        )
        .returning();

      if (updated.length === 0) {
        log.warn(
          { event: "version_conflict", messageId: msg.messageId, tenantId: msg.tenantId, expectedVersion: p.version },
          "milestone transition skipped (version mismatch)",
        );
        return;
      }

      const base = {
        id: p.id,
        tenantId: msg.tenantId,
        contractId: existing.contractId,
        milestoneCode: existing.milestoneCode,
        amountMinor: existing.amountMinor === null ? null : existing.amountMinor.toString(),
        currency: existing.currency,
      };

      if (p.toStatus === "met") {
        await emit(tx, msg, EVENTS.mouMilestoneMet, { ...base, completedAt: (updates.completedAt as Date).toISOString() });
      } else if (p.toStatus === "missed") {
        await emit(tx, msg, EVENTS.mouMilestoneMissed, {
          ...base,
          dueDate: existing.dueDate,
          overdueDays: daysOverdue(existing.dueDate, now.toISOString().slice(0, 10)),
        });
      } else {
        await emit(tx, msg, EVENTS.mouMilestoneWaived, {
          id: p.id,
          tenantId: msg.tenantId,
          contractId: existing.contractId,
          milestoneCode: existing.milestoneCode,
          waivedBy: msg.actorId,
          waivedAt: now.toISOString(),
          waiverReason: p.waiverReason,
        });
      }
      await audit(tx, msg, `mou_milestone_${p.toStatus}`, "mou_milestone", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "mou-milestone", p.id));
  });

  // ══ Create a penalty / SLA term ══════════════════════════════════════════
  q.subscribe(COMMANDS.mouPenaltyTermCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string; termCode: string; description: string;
      triggerType: string; thresholdValue: number; penaltyKind: string;
      penaltyAmountMinor: string | null; penaltyRateBps: number | null;
      maxPenaltyBps: number; currency: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const inserted = await tx
        .insert(penaltyTerms)
        .values({
          id: p.id,
          tenantId: msg.tenantId,
          contractId: p.contractId,
          termCode: p.termCode,
          description: p.description,
          triggerType: p.triggerType,
          thresholdValue: p.thresholdValue,
          penaltyKind: p.penaltyKind,
          penaltyAmountMinor: toBigIntOrNull(p.penaltyAmountMinor),
          penaltyRateBps: p.penaltyRateBps,
          maxPenaltyBps: p.maxPenaltyBps,
          currency: p.currency,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })
        .onConflictDoNothing({
          target: [penaltyTerms.tenantId, penaltyTerms.contractId, penaltyTerms.termCode],
        })
        .returning({ id: penaltyTerms.id });

      if (inserted.length === 0) {
        log.warn(
          { event: "duplicate_term_code", messageId: msg.messageId, tenantId: msg.tenantId, contractId: p.contractId },
          "penalty term code already exists for this contract — skipping",
        );
        return;
      }

      await emit(tx, msg, EVENTS.mouPenaltyTermCreated, {
        id: p.id,
        tenantId: msg.tenantId,
        contractId: p.contractId,
        termCode: p.termCode,
        triggerType: p.triggerType,
        penaltyKind: p.penaltyKind,
        penaltyAmountMinor: p.penaltyAmountMinor,
        penaltyRateBps: p.penaltyRateBps,
        maxPenaltyBps: p.maxPenaltyBps,
        currency: p.currency,
      });
      await audit(tx, msg, "mou_penalty_term_create", "mou_penalty_term", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "mou-penalty-term", p.id));
  });

  // ══ Apply a penalty ══════════════════════════════════════════════════════
  q.subscribe(COMMANDS.mouPenaltyApply, async (msg) => {
    const p = msg.payload as {
      tenantId: string; penaltyTermId: string; milestoneId?: string;
      occurrenceRef: string; overdueDays: number; milestoneAmountMinor: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [term] = await tx
        .select()
        .from(penaltyTerms)
        .where(and(eq(penaltyTerms.id, p.penaltyTermId), eq(penaltyTerms.tenantId, msg.tenantId)))
        .limit(1);
      if (!term) {
        log.warn({ event: "penalty_term_not_found", messageId: msg.messageId, tenantId: msg.tenantId }, "penalty apply skipped");
        return;
      }
      if (!term.active) {
        log.warn({ event: "penalty_term_inactive", messageId: msg.messageId, tenantId: msg.tenantId }, "penalty apply skipped");
        return;
      }

      const trigger = term.triggerType === "sla_breached" ? "sla_breached" : "milestone_missed";
      const key = occurrenceKey(trigger, p.occurrenceRef);

      const result = computePenalty({
        term: {
          penaltyKind: term.penaltyKind as PenaltyKind,
          penaltyAmountMinor: term.penaltyAmountMinor ?? undefined,
          penaltyRateBps: term.penaltyRateBps ?? undefined,
          maxPenaltyBps: term.maxPenaltyBps,
          thresholdValue: term.thresholdValue,
        },
        milestoneAmountMinor: BigInt(p.milestoneAmountMinor),
        overdueDays: p.overdueDays,
      });

      const applicationId = randomUUID();
      // The double-count guard. onConflictDoNothing turns the UNIQUE violation
      // into an empty result set, so a duplicate occurrence is a clean no-op
      // rather than an aborted transaction — and, critically, NO event is
      // emitted, so finance-service never raises a second recovery.
      const inserted = await tx
        .insert(penaltyApplications)
        .values({
          id: applicationId,
          tenantId: msg.tenantId,
          contractId: term.contractId,
          penaltyTermId: term.id,
          milestoneId: p.milestoneId ?? null,
          occurrenceKey: key,
          computedAmountMinor: result.penaltyMinor,
          currency: term.currency,
          basis: {
            penaltyKind: term.penaltyKind,
            thresholdValue: term.thresholdValue,
            overdueDays: p.overdueDays,
            chargeableDays: result.chargeableDays,
            milestoneAmountMinor: p.milestoneAmountMinor,
            uncappedMinor: result.uncappedMinor.toString(),
            capMinor: result.capMinor.toString(),
            capped: result.capped,
          },
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })
        .onConflictDoNothing({
          target: [penaltyApplications.tenantId, penaltyApplications.penaltyTermId, penaltyApplications.occurrenceKey],
        })
        .returning();

      if (inserted.length === 0) {
        log.warn(
          { event: "penalty_already_applied", messageId: msg.messageId, tenantId: msg.tenantId, occurrenceKey: key },
          "penalty already applied for this occurrence — not charging twice",
        );
        return;
      }

      // Reflect the penalty on the milestone so the payable figure is correct.
      if (p.milestoneId) {
        await tx
          .update(contractMilestones)
          .set({
            penaltyMinor: result.penaltyMinor,
            netPayableMinor: result.netPayableMinor,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          })
          .where(and(eq(contractMilestones.id, p.milestoneId), eq(contractMilestones.tenantId, msg.tenantId)));
      }

      await emit(tx, msg, EVENTS.mouPenaltyApplied, {
        id: applicationId,
        tenantId: msg.tenantId,
        contractId: term.contractId,
        penaltyTermId: term.id,
        milestoneId: p.milestoneId ?? null,
        occurrenceKey: key,
        computedAmountMinor: result.penaltyMinor.toString(),
        currency: term.currency,
        capped: result.capped,
        chargeableDays: result.chargeableDays,
      });
      await audit(tx, msg, "mou_penalty_apply", "mou_penalty_application", applicationId);
    });

    if (p.milestoneId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "mou-milestone", p.milestoneId));
    }
  });

  // ══ Schedule a review ════════════════════════════════════════════════════
  q.subscribe(COMMANDS.mouReviewSchedule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string; reviewCode: string;
      cadence: string; nextReviewDate: string; reviewerRole: string; notes?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const inserted = await tx
        .insert(reviewSchedules)
        .values({
          id: p.id,
          tenantId: msg.tenantId,
          contractId: p.contractId,
          reviewCode: p.reviewCode,
          cadence: p.cadence,
          nextReviewDate: p.nextReviewDate,
          reviewerRole: p.reviewerRole,
          status: "scheduled",
          notes: p.notes ?? null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })
        .onConflictDoNothing({
          target: [reviewSchedules.tenantId, reviewSchedules.contractId, reviewSchedules.reviewCode],
        })
        .returning({ id: reviewSchedules.id });

      if (inserted.length === 0) {
        log.warn(
          { event: "duplicate_review_code", messageId: msg.messageId, tenantId: msg.tenantId, contractId: p.contractId },
          "review code already scheduled for this contract — skipping",
        );
        return;
      }

      await emit(tx, msg, EVENTS.mouReviewScheduled, {
        id: p.id,
        tenantId: msg.tenantId,
        contractId: p.contractId,
        reviewCode: p.reviewCode,
        cadence: p.cadence,
        nextReviewDate: p.nextReviewDate,
        reviewerRole: p.reviewerRole,
      });
      await audit(tx, msg, "mou_review_schedule", "mou_review_schedule", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "mou-review", p.id));
  });

  // ══ Complete a review cycle ══════════════════════════════════════════════
  q.subscribe(COMMANDS.mouReviewComplete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; notes?: string };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [existing] = await tx
        .select()
        .from(reviewSchedules)
        .where(and(eq(reviewSchedules.id, p.id), eq(reviewSchedules.tenantId, msg.tenantId)))
        .limit(1);
      if (!existing) {
        log.warn({ event: "review_not_found", messageId: msg.messageId, tenantId: msg.tenantId }, "review complete skipped");
        return;
      }
      if (existing.status !== "scheduled") {
        log.warn(
          { event: "review_not_scheduled", messageId: msg.messageId, tenantId: msg.tenantId, status: existing.status },
          "review complete skipped",
        );
        return;
      }

      const now = new Date();
      // Advance from the scheduled date, not from today, so a review completed
      // late does not shift the whole cadence forward.
      const advanced = nextReviewDate(existing.nextReviewDate, existing.cadence);

      const updated = await tx
        .update(reviewSchedules)
        .set({
          lastReviewedAt: now,
          nextReviewDate: advanced,
          status: "scheduled",
          ...(p.notes !== undefined && { notes: p.notes }),
          updatedBy: msg.actorId,
          updatedAt: now,
          version: p.version + 1,
        })
        .where(
          and(
            eq(reviewSchedules.id, p.id),
            eq(reviewSchedules.tenantId, msg.tenantId),
            eq(reviewSchedules.version, p.version),
          ),
        )
        .returning();

      if (updated.length === 0) {
        log.warn(
          { event: "version_conflict", messageId: msg.messageId, tenantId: msg.tenantId, expectedVersion: p.version },
          "review complete skipped (version mismatch)",
        );
        return;
      }

      await emit(tx, msg, EVENTS.mouReviewCompleted, {
        id: p.id,
        tenantId: msg.tenantId,
        contractId: existing.contractId,
        reviewCode: existing.reviewCode,
        reviewedAt: now.toISOString(),
        nextReviewDate: advanced,
      });
      await audit(tx, msg, "mou_review_complete", "mou_review_schedule", p.id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "mou-review", p.id));
  });
}
