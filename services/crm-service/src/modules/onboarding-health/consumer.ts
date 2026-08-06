/**
 * Onboarding health metric consumers (G19).
 *
 * Handles:
 * - createOnboardingHealthRule: insert a new rule
 * - updateOnboardingHealthRule: patch an existing rule (optimistic lock)
 * - recomputeOnboardingHealth: re-evaluate score for a case
 *
 * Each follows the standard pattern: markProcessed → write → emitWithAudit → cache invalidate.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { invalidateHealthRules, invalidateHealthScore, ruleKeyFor } from "./queries.js";
import { cache } from "../../shared/infra.js";
import { computeOnboardingHealth, type HealthRule, type MilestoneEvent } from "./domain.js";

const log = pino({ name: "crm-onboarding-health-consumer" });

const RULES_RESOURCE = "onboarding_health_rule";
const SCORES_RESOURCE = "onboarding_health_score";

type CtxLike = Parameters<typeof emitWithAudit>[1];

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): CtxLike {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as CtxLike;
}

interface CreateRulePayload {
  id: string;
  tenantId: string;
  ruleKey: string;
  milestoneEvent: string;
  expectedWithinDays: number;
  weight: number;
  active: boolean;
}

interface UpdateRulePayload {
  id: string;
  tenantId: string;
  changed: {
    milestoneEvent?: string;
    expectedWithinDays?: number;
    weight?: number;
    active?: boolean;
  };
  version: number;
}

interface RecomputePayload {
  id: string;
  tenantId: string;
  caseId: string;
}

export function registerOnboardingHealthConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createOnboardingHealthRule, async (msg) => {
    const p = msg.payload as CreateRulePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const id = p.id || randomUUID();
        await tx.execute(sql`
          INSERT INTO crm.onboarding_health_rules
            (id, tenant_id, rule_key, milestone_event, expected_within_days, weight, active, created_by, updated_by)
          VALUES (
            ${id}, ${p.tenantId}, ${p.ruleKey}, ${p.milestoneEvent},
            ${p.expectedWithinDays}, ${p.weight}, ${p.active},
            ${msg.actorId}, ${msg.actorId}
          )
          ON CONFLICT (tenant_id, rule_key) DO NOTHING
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.onboardingHealthRuleCreated,
          action: "create",
          resourceType: RULES_RESOURCE,
          resourceId: id,
          payload: {
            ruleId: id,
            ruleKey: p.ruleKey,
            milestoneEvent: p.milestoneEvent,
            expectedWithinDays: p.expectedWithinDays,
            weight: p.weight,
            active: p.active,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createOnboardingHealthRule failed");
      throw err;
    }
    await invalidateHealthRules(msg.tenantId);
  });

  queue.subscribe(COMMANDS.updateOnboardingHealthRule, async (msg) => {
    const p = msg.payload as UpdateRulePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Build dynamic SET clause
        const sets: string[] = ["updated_at = now()", "updated_by = " + `'${msg.actorId}'`, "version = version + 1"];
        if (p.changed.milestoneEvent !== undefined) {
          sets.push(`milestone_event = '${p.changed.milestoneEvent}'`);
        }
        if (p.changed.expectedWithinDays !== undefined) {
          sets.push(`expected_within_days = ${p.changed.expectedWithinDays}`);
        }
        if (p.changed.weight !== undefined) {
          sets.push(`weight = ${p.changed.weight}`);
        }
        if (p.changed.active !== undefined) {
          sets.push(`active = ${p.changed.active}`);
        }

        const rows = (await tx.execute(sql`
          UPDATE crm.onboarding_health_rules
          SET ${sql.raw(sets.join(", "))}
          WHERE id = ${p.id}
            AND tenant_id = ${p.tenantId}
            AND version = ${p.version}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;

        if (rows.length === 0) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.onboardingHealthRuleUpdated,
            action: "update",
            resourceType: RULES_RESOURCE,
            resourceId: p.id,
            payload: { ruleId: p.id, rejected: true },
            outcome: "rejected_stale_state",
          });
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.onboardingHealthRuleUpdated,
          action: "update",
          resourceType: RULES_RESOURCE,
          resourceId: p.id,
          payload: { ruleId: p.id, changed: p.changed },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateOnboardingHealthRule failed");
      throw err;
    }
    await cache.invalidate(ruleKeyFor(msg.tenantId, p.id));
    await invalidateHealthRules(msg.tenantId);
  });

  queue.subscribe(COMMANDS.recomputeOnboardingHealth, async (msg) => {
    const p = msg.payload as RecomputePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Load the onboarding case
        const caseRows = (await tx.execute(sql`
          SELECT id, tenant_id AS "tenantId", created_at AS "createdAt"
          FROM crm.onboarding_cases
          WHERE id = ${p.caseId} AND tenant_id = ${p.tenantId}
        `)) as unknown as Array<{ id: string; tenantId: string; createdAt: Date }>;

        if (caseRows.length === 0) {
          log.warn({ caseId: p.caseId, tenantId: p.tenantId }, "recompute: case not found");
          return;
        }

        const caseRow = caseRows[0]!;

        // Load active rules for tenant
        const ruleRows = (await tx.execute(sql`
          SELECT rule_key AS "ruleKey", milestone_event AS "milestoneEvent",
                 expected_within_days AS "expectedWithinDays", weight, active
          FROM crm.onboarding_health_rules
          WHERE tenant_id = ${p.tenantId} AND active = true
        `)) as unknown as HealthRule[];

        // For now, milestone events are derived from the onboarding case itself.
        // Future: query from a milestone_events table or external events.
        const milestoneEvents: MilestoneEvent[] = [];

        // Check onboarding case stage/kyc for built-in milestones
        const caseDetails = (await tx.execute(sql`
          SELECT stage, kyc_status AS "kycStatus", kyc_verified_at AS "kycVerifiedAt",
                 completed_at AS "completedAt"
          FROM crm.onboarding_cases
          WHERE id = ${p.caseId} AND tenant_id = ${p.tenantId}
        `)) as unknown as Array<{
          stage: string;
          kycStatus: string;
          kycVerifiedAt: Date | null;
          completedAt: Date | null;
        }>;

        const detail = caseDetails[0];
        if (detail) {
          if (detail.kycVerifiedAt) {
            milestoneEvents.push({ eventType: "kyc_verified", occurredAt: detail.kycVerifiedAt });
          }
          if (detail.completedAt) {
            milestoneEvents.push({ eventType: "onboarding_completed", occurredAt: detail.completedAt });
          }
        }

        const now = new Date();
        const result = computeOnboardingHealth(ruleRows, milestoneEvents, caseRow.createdAt, now);

        // Upsert the score
        const scoreId = randomUUID();
        await tx.execute(sql`
          INSERT INTO crm.onboarding_health_scores
            (id, tenant_id, case_id, score, milestones_hit, computed_at)
          VALUES (
            ${scoreId}, ${p.tenantId}, ${p.caseId}, ${result.score},
            ${JSON.stringify(result.milestones)}::jsonb, now()
          )
          ON CONFLICT (tenant_id, case_id) DO UPDATE SET
            score = ${result.score},
            milestones_hit = ${JSON.stringify(result.milestones)}::jsonb,
            computed_at = now(),
            updated_at = now(),
            version = crm.onboarding_health_scores.version + 1
        `);

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.onboardingHealthRecomputed,
          action: "recompute",
          resourceType: SCORES_RESOURCE,
          resourceId: p.caseId,
          payload: { caseId: p.caseId, score: result.score, milestonesCount: result.milestones.length },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "recomputeOnboardingHealth failed");
      throw err;
    }
    await invalidateHealthScore(msg.tenantId, p.caseId);
  });
}
