/**
 * LQ-002 persistence: per-tenant scoring rules (lazy-seeded defaults) + score history.
 * Admin PUT is synchronous + transactionally audited (dedup-rules pattern).
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import {
  leadScoreRules,
  leadScoreHistory,
  type LeadScoreRuleRow,
  type LeadScoreHistoryRow,
} from "./score-rules-schema.js";
import {
  DEFAULT_SCORE_RULE_CONFIGS,
  toScoringRules,
  type StoredScoreRule,
  type ScoreFnType,
} from "./score-rules-domain.js";
import type { ScoringRule } from "./scoring.js";

const AUDIT_TOPIC = "audit.event.record";

function toStored(r: LeadScoreRuleRow): StoredScoreRule {
  return {
    attribute: r.attribute,
    weight: r.weight,
    scoreFnType: r.scoreFnType as ScoreFnType,
    params: (r.params as Record<string, unknown>) ?? {},
    enabled: r.enabled,
  };
}

export interface ScoreRuleView extends StoredScoreRule {
  id: string;
  version: number;
  updatedAt: string;
}
function toView(r: LeadScoreRuleRow): ScoreRuleView {
  return { ...toStored(r), id: r.id, version: r.version, updatedAt: r.updatedAt.toISOString() };
}

/** The tenant's stored rules, lazy-seeding the code defaults on first read. */
export async function getStoredRules(tenantId: string, actorId: string): Promise<StoredScoreRule[]> {
  const existing = await scopedRead((tx) =>
    tx.select().from(leadScoreRules).where(eq(leadScoreRules.tenantId, tenantId)),
  );
  if (existing.length > 0) return existing.map(toStored);

  await db.transaction(async (tx) => {
    for (const d of DEFAULT_SCORE_RULE_CONFIGS) {
      await tx.insert(leadScoreRules).values({
        tenantId,
        attribute: d.attribute,
        weight: d.weight,
        scoreFnType: d.scoreFnType,
        params: d.params,
        enabled: d.enabled,
        createdBy: actorId,
        updatedBy: actorId,
      }).onConflictDoNothing();
    }
  });
  const seeded = await scopedRead((tx) =>
    tx.select().from(leadScoreRules).where(eq(leadScoreRules.tenantId, tenantId)),
  );
  return seeded.map(toStored);
}

/** Admin GET view (includes ids/versions), seeding defaults on first read. */
export async function getRuleViews(tenantId: string, actorId: string): Promise<ScoreRuleView[]> {
  await getStoredRules(tenantId, actorId); // ensure seeded
  const rows = await scopedRead((tx) =>
    tx.select().from(leadScoreRules).where(eq(leadScoreRules.tenantId, tenantId)).orderBy(leadScoreRules.attribute),
  );
  return rows.map(toView);
}

/** Executable ScoringRules for the scorer, from the tenant's configuration. */
export async function getScoringRules(tenantId: string, actorId: string): Promise<ScoringRule[]> {
  return toScoringRules(await getStoredRules(tenantId, actorId));
}

export interface RuleUpsert {
  attribute: string;
  weight: number;
  scoreFnType: ScoreFnType;
  params: Record<string, unknown>;
  enabled: boolean;
}

/** Upsert rules by (tenant, attribute); a partial PUT is additive. Audited. */
export async function upsertRules(
  tenantId: string,
  rules: RuleUpsert[],
  actorId: string,
  correlationId: string,
): Promise<ScoreRuleView[]> {
  await db.transaction(async (tx) => {
    for (const r of rules) {
      await tx.insert(leadScoreRules).values({
        tenantId,
        attribute: r.attribute,
        weight: r.weight,
        scoreFnType: r.scoreFnType,
        params: r.params,
        enabled: r.enabled,
        createdBy: actorId,
        updatedBy: actorId,
      }).onConflictDoUpdate({
        target: [leadScoreRules.tenantId, leadScoreRules.attribute],
        set: {
          weight: r.weight,
          scoreFnType: r.scoreFnType,
          params: r.params,
          enabled: r.enabled,
          updatedAt: new Date(),
          updatedBy: actorId,
          version: sql`${leadScoreRules.version} + 1`,
        },
      });
    }
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId,
      actorId,
      correlationId,
      payload: {
        service: "crm",
        action: "lead_score_rules_update",
        resourceType: "lead_score_rule",
        resourceId: tenantId,
        outcome: "success",
        metadata: { ruleCount: rules.length, attributes: rules.map((r) => r.attribute) },
      },
    });
  });
  return getRuleViews(tenantId, actorId);
}

// ── Score history ───────────────────────────────────────────────────────────────

export interface ScoreHistoryInsert {
  tenantId: string;
  leadId: string;
  score: number;
  previousScore: number | null;
  factors: Record<string, unknown>;
  source: "rule" | "ml";
  reason: string | null;
}

/** Insert a score-history row using a caller-supplied writer (inside its tx). */
export async function insertScoreHistory(
  tx: Pick<typeof db, "insert">,
  row: ScoreHistoryInsert,
): Promise<void> {
  await tx.insert(leadScoreHistory).values({
    tenantId: row.tenantId,
    leadId: row.leadId,
    score: row.score,
    previousScore: row.previousScore,
    factors: row.factors,
    source: row.source,
    reason: row.reason,
  });
}

export interface ScoreHistoryView {
  id: string;
  leadId: string;
  score: number;
  previousScore: number | null;
  factors: Record<string, unknown>;
  source: string;
  reason: string | null;
  scoredAt: string;
}
function toHistoryView(r: LeadScoreHistoryRow): ScoreHistoryView {
  return {
    id: r.id,
    leadId: r.leadId,
    score: r.score,
    previousScore: r.previousScore,
    factors: (r.factors as Record<string, unknown>) ?? {},
    source: r.source,
    reason: r.reason,
    scoredAt: r.scoredAt.toISOString(),
  };
}

export async function listHistory(tenantId: string, leadId: string, limit = 50): Promise<ScoreHistoryView[]> {
  const rows = await scopedRead((tx) => tx.select().from(leadScoreHistory)
    .where(and(eq(leadScoreHistory.tenantId, tenantId), eq(leadScoreHistory.leadId, leadId)))
    .orderBy(desc(leadScoreHistory.scoredAt))
    .limit(limit));
  return rows.map(toHistoryView);
}
