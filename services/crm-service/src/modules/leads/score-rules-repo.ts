/**
 * LQ-002 persistence: per-tenant scoring rules (lazy-seeded defaults) + score history.
 * Admin PUT is synchronous + transactionally audited (dedup-rules pattern).
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
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
  leadAttributesFromRow,
  type StoredScoreRule,
  type ScoreFnType,
} from "./score-rules-domain.js";
import { computeLeadScore, type ScoringRule } from "./scoring.js";

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

/**
 * GAP-CRM-LEAD-SCORING-05 — list-level optimistic-concurrency metadata, derived
 * from `SUM(version)` across the tenant's rows (every upsert bumps a row's
 * version by at least 1, so the sum strictly increases on any change). No schema
 * change required.
 */
export interface ScoreRulesListMeta {
  version: string;
  updatedBy: string | null;
  updatedAt: string | null;
}
export interface ScoreRulesList {
  rules: ScoreRuleView[];
  meta: ScoreRulesListMeta;
}

type VersionRow = { version: string | number | null; updatedBy: string | null; updatedAt: Date | string | null };

async function readListMeta(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  tenantId: string,
  lock: boolean,
): Promise<ScoreRulesListMeta> {
  if (lock) {
    await tx.execute(sql`SELECT id FROM crm.lead_score_rules WHERE tenant_id = ${tenantId} FOR UPDATE`);
  }
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(version), 0)::text AS version,
           (SELECT updated_by FROM crm.lead_score_rules WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC LIMIT 1) AS "updatedBy",
           (SELECT updated_at FROM crm.lead_score_rules WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC LIMIT 1) AS "updatedAt"
    FROM crm.lead_score_rules
    WHERE tenant_id = ${tenantId}
  `)) as unknown as VersionRow[];
  const r = rows[0];
  const updatedAt = r?.updatedAt ?? null;
  return {
    version: String(r?.version ?? "0"),
    updatedBy: r?.updatedBy ?? null,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
}

/** Admin GET view plus the list-level concurrency token (seeds on first read). */
export async function getRuleViewsList(tenantId: string, actorId: string): Promise<ScoreRulesList> {
  const rules = await getRuleViews(tenantId, actorId);
  const meta = await scopedRead((tx) => readListMeta(tx, tenantId, false));
  return { rules, meta };
}

/** Executable ScoringRules for the scorer, from the tenant's configuration. */
export async function getScoringRules(tenantId: string, actorId: string): Promise<ScoringRule[]> {
  return toScoringRules(await getStoredRules(tenantId, actorId));
}

/**
 * Tx-scoped twin of getStoredRules for callers already inside an open
 * transaction (see .claude/skills/16-production-readiness-audit.md section 1):
 * scopedRead/db.transaction open their own connection, so calling the
 * non-Tx variant from inside another transaction deadlocks the pool. Reads
 * and the lazy-seed insert both go through the caller-supplied tx.
 */
export async function getStoredRulesTx(
  tx: Pick<typeof db, "select" | "insert">,
  tenantId: string,
  actorId: string,
): Promise<StoredScoreRule[]> {
  const existing = await tx.select().from(leadScoreRules).where(eq(leadScoreRules.tenantId, tenantId));
  if (existing.length > 0) return existing.map(toStored);

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
  const seeded = await tx.select().from(leadScoreRules).where(eq(leadScoreRules.tenantId, tenantId));
  return seeded.map(toStored);
}

/** Tx-scoped twin of getScoringRules — see getStoredRulesTx. */
export async function getScoringRulesTx(
  tx: Pick<typeof db, "select" | "insert">,
  tenantId: string,
  actorId: string,
): Promise<ScoringRule[]> {
  return toScoringRules(await getStoredRulesTx(tx, tenantId, actorId));
}

export interface RuleUpsert {
  attribute: string;
  weight: number;
  scoreFnType: ScoreFnType;
  params: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Upsert rules by (tenant, attribute); a partial PUT is additive. Audited.
 *
 * GAP-CRM-LEAD-SCORING-05 optimistic concurrency: when `expectedVersion` is
 * supplied, the tenant's rows are locked (`FOR UPDATE`) and the list version
 * re-read inside the write transaction before any mutation; a mismatch throws
 * 409 VERSION_CONFLICT and the transaction rolls back untouched.
 */
export async function upsertRules(
  tenantId: string,
  rules: RuleUpsert[],
  actorId: string,
  correlationId: string,
  expectedVersion?: string,
): Promise<ScoreRulesList> {
  await db.transaction(async (tx) => {
    if (expectedVersion !== undefined) {
      const current = await readListMeta(tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, tenantId, true);
      if (current.version !== expectedVersion) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "These scoring rules were changed by another admin. Reload to see the latest, then re-apply your changes.",
        );
      }
    }
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
  return getRuleViewsList(tenantId, actorId);
}

// ── Dry-run preview (GAP-CRM-LEAD-SCORING-04) ───────────────────────────────────

/** Most leads a preview scores in memory; beyond this the result says so (truncated). */
export const SCORE_PREVIEW_SAMPLE_LIMIT = 5000;

/** Five equal-width score bands, shared by the stored and the proposed distribution. */
const PREVIEW_BANDS = [
  { label: "0-19", min: 0, max: 19 },
  { label: "20-39", min: 20, max: 39 },
  { label: "40-59", min: 40, max: 59 },
  { label: "60-79", min: 60, max: 79 },
  { label: "80-100", min: 80, max: 100 },
] as const;

export interface ScorePreviewBand {
  label: string;
  /** Leads whose STORED score falls in this band. */
  current: number;
  /** Leads that WOULD fall in this band under the proposed rules. */
  proposed: number;
}
export interface ScorePreview {
  /** Active leads in the tenant. */
  totalLeads: number;
  /** Leads actually scored in the preview (<= SCORE_PREVIEW_SAMPLE_LIMIT, most recently updated first). */
  sampled: number;
  truncated: boolean;
  /** Sampled leads with no stored score yet. */
  unscored: number;
  currentAverage: number | null;
  proposedAverage: number | null;
  /** Sampled leads whose stored score differs from the proposed one (unscored leads excluded). */
  changed: number;
  raised: number;
  lowered: number;
  /** Sum of the enabled proposed weights, and the highest score they can ever produce. */
  totalWeight: number;
  maxPossibleScore: number;
  bands: ScorePreviewBand[];
}

function bandIndex(score: number): number {
  const i = PREVIEW_BANDS.findIndex((b) => score >= b.min && score <= b.max);
  return i < 0 ? PREVIEW_BANDS.length - 1 : i;
}

/**
 * Score the tenant's active leads with a PROPOSED rule set without persisting anything,
 * using the exact scorer + attribute extraction the real recalculation uses
 * (computeLeadScore / leadAttributesFromRow), and compare against the stored scores.
 * Read-only: no writes, no audit event.
 */
export async function previewRules(tenantId: string, proposed: RuleUpsert[]): Promise<ScorePreview> {
  const scoringRules = toScoringRules(proposed);
  const { total, rows } = await scopedRead(async (tx) => {
    const countRows = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM crm.contacts WHERE tenant_id = ${tenantId} AND status = 'active'
    `)) as unknown as Array<{ n: number }>;
    const leadRows = (await tx.execute(sql`
      SELECT lead_source, company, last_activity_at, email, phone, lead_status, city, designation, score
      FROM crm.contacts
      WHERE tenant_id = ${tenantId} AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT ${SCORE_PREVIEW_SAMPLE_LIMIT}
    `)) as unknown as Array<Record<string, unknown>>;
    return { total: Number(countRows[0]?.n ?? 0), rows: leadRows };
  });

  const bands: ScorePreviewBand[] = PREVIEW_BANDS.map((b) => ({ label: b.label, current: 0, proposed: 0 }));
  let proposedSum = 0;
  let currentSum = 0;
  let currentCount = 0;
  let changed = 0;
  let raised = 0;
  let lowered = 0;
  let unscored = 0;
  for (const row of rows) {
    const next = computeLeadScore(leadAttributesFromRow(row), scoringRules);
    proposedSum += next;
    bands[bandIndex(next)]!.proposed += 1;
    if (row.score === null || row.score === undefined) {
      unscored += 1;
      continue;
    }
    const prev = Number(row.score);
    currentSum += prev;
    currentCount += 1;
    bands[bandIndex(prev)]!.current += 1;
    if (next > prev) { raised += 1; changed += 1; }
    else if (next < prev) { lowered += 1; changed += 1; }
  }
  const totalWeight = proposed.reduce((sum, r) => sum + (r.enabled ? r.weight : 0), 0);
  const avg = (sum: number, n: number) => (n === 0 ? null : Math.round((sum / n) * 10) / 10);
  return {
    totalLeads: total,
    sampled: rows.length,
    truncated: total > rows.length,
    unscored,
    currentAverage: avg(currentSum, currentCount),
    proposedAverage: avg(proposedSum, rows.length),
    changed,
    raised,
    lowered,
    totalWeight,
    maxPossibleScore: Math.min(100, totalWeight),
    bands,
  };
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
