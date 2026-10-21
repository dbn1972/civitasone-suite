/**
 * LQ-002 — pure translation of a stored, per-tenant scoring rule into an executable
 * ScoringRule (attribute + weight + scoreFn) for scoring.computeLeadScore.
 *
 * The stored form is serializable ({ attribute, weight, scoreFnType, params }); the
 * scoreFn is rebuilt here so scoring stays configuration-driven while the pure scorer
 * (scoring.ts) is unchanged. DEFAULT_SCORE_RULE_CONFIGS reproduces the historical
 * hardcoded defaults exactly, and is what gets lazy-seeded for a tenant with no rules.
 */
import type { ScoringRule } from "./scoring.js";

export type ScoreFnType = "presence" | "map" | "recency" | "numeric_threshold";

export interface StoredScoreRule {
  attribute: string;
  weight: number;
  scoreFnType: ScoreFnType;
  params: Record<string, unknown>;
  enabled: boolean;
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function daysSince(value: unknown): number | null {
  if (value == null || value === "") return null;
  const t = new Date(String(value)).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

/** Build a value → 0-100 scoring function from a stored rule's type + params. */
export function buildScoreFn(type: ScoreFnType, params: Record<string, unknown>): (value: unknown) => number {
  switch (type) {
    case "presence": {
      const present = Number(params.present ?? 100);
      const absent = Number(params.absent ?? 0);
      return (value) => clamp(value ? present : absent);
    }
    case "map": {
      const values = (params.values as Record<string, number> | undefined) ?? {};
      const dflt = Number(params.default ?? 0);
      return (value) => {
        const key = String(value ?? "").toLowerCase();
        return clamp(Object.prototype.hasOwnProperty.call(values, key) ? Number(values[key]) : dflt);
      };
    }
    case "recency": {
      const tiers = ((params.tiers as Array<{ maxDays: number; score: number }> | undefined) ?? [])
        .slice()
        .sort((a, b) => a.maxDays - b.maxDays);
      const beyond = Number(params.beyondScore ?? 0);
      const absentScore = Number(params.absentScore ?? 0);
      return (value) => {
        const days = daysSince(value);
        if (days === null) return clamp(absentScore);
        for (const t of tiers) {
          if (days <= Number(t.maxDays)) return clamp(Number(t.score));
        }
        return clamp(beyond);
      };
    }
    case "numeric_threshold": {
      const tiers = ((params.tiers as Array<{ min: number; score: number }> | undefined) ?? [])
        .slice()
        .sort((a, b) => a.min - b.min);
      const dflt = Number(params.default ?? 0);
      return (value) => {
        if (value == null || value === "") return clamp(dflt);
        const val = Number(value);
        if (Number.isNaN(val)) return clamp(dflt);
        let best = dflt;
        for (const t of tiers) {
          if (val >= Number(t.min)) best = Number(t.score);
        }
        return clamp(best);
      };
    }
    default:
      return () => 0;
  }
}

/**
 * GAP-CRM-LEAD-SCORING-03: the lead attributes a rule can actually score on.
 *
 * This is the scorer's whole input (consumer.ts recalculateScore builds the attribute
 * map from exactly these crm.contacts columns via leadAttributesFromRow), so a rule on
 * any other attribute would be scored against `undefined` on every lead and never
 * contribute real signal. The validator rejects such a rule at save time and the GET
 * advertises this list so the editor offers only real fields. Custom fields are NOT
 * scoreable today (they are not part of the scoring input) - opening this list to
 * them is a product decision, see the gap ledger.
 */
export const SCORE_ATTRIBUTE_COLUMNS = {
  leadSource: "lead_source",
  company: "company",
  lastActivityAt: "last_activity_at",
  email: "email",
  phone: "phone",
  leadStatus: "lead_status",
  city: "city",
  designation: "designation",
} as const;
export type ScoreableLeadAttribute = keyof typeof SCORE_ATTRIBUTE_COLUMNS;
export const SCOREABLE_LEAD_ATTRIBUTES = Object.keys(SCORE_ATTRIBUTE_COLUMNS) as ScoreableLeadAttribute[];

export function isScoreableAttribute(attribute: string): attribute is ScoreableLeadAttribute {
  return Object.prototype.hasOwnProperty.call(SCORE_ATTRIBUTE_COLUMNS, attribute);
}

/** crm.contacts row (snake_case columns) -> the attribute map the scorer evaluates. */
export function leadAttributesFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of SCOREABLE_LEAD_ATTRIBUTES) out[attr] = row[SCORE_ATTRIBUTE_COLUMNS[attr]];
  return out;
}

/**
 * The rule set a PUT would leave behind. PUT is an additive upsert by (tenant, attribute):
 * a proposed rule replaces the stored rule for its attribute and every stored rule the
 * proposal omits is kept as it is. Proposed entries apply in order, so a later entry wins
 * over an earlier one with the same attribute (exactly like the sequential upserts).
 * The dry-run preview scores THIS set, so its numbers describe the rules Save will leave behind.
 */
export function overlayRules(
  stored: readonly StoredScoreRule[],
  proposed: readonly StoredScoreRule[],
): StoredScoreRule[] {
  const byAttribute = new Map<string, StoredScoreRule>();
  for (const r of stored) byAttribute.set(r.attribute, r);
  for (const r of proposed) byAttribute.set(r.attribute, r);
  return [...byAttribute.values()];
}

/** Turn stored rules into executable ScoringRules, dropping disabled ones. */
export function toScoringRules(stored: readonly StoredScoreRule[]): ScoringRule[] {
  return stored
    .filter((r) => r.enabled)
    .map((r) => ({
      attribute: r.attribute,
      weight: r.weight,
      scoreFn: buildScoreFn(r.scoreFnType, r.params ?? {}),
    }));
}

/**
 * The historical hardcoded defaults, as serializable configs. Weights sum to 100 so
 * computeLeadScore normalises correctly. Seeded lazily for a tenant with no rules.
 */
export const DEFAULT_SCORE_RULE_CONFIGS: StoredScoreRule[] = [
  {
    attribute: "leadSource",
    weight: 30,
    scoreFnType: "map",
    params: {
      values: { referral: 90, website: 70, campaign: 60, event: 50, cold_call: 30, social: 40 },
      default: 20,
    },
    enabled: true,
  },
  { attribute: "company", weight: 25, scoreFnType: "presence", params: { present: 70, absent: 20 }, enabled: true },
  {
    attribute: "lastActivityAt",
    weight: 25,
    scoreFnType: "recency",
    params: {
      tiers: [
        { maxDays: 7, score: 100 },
        { maxDays: 14, score: 80 },
        { maxDays: 30, score: 60 },
        { maxDays: 60, score: 40 },
      ],
      beyondScore: 20,
      absentScore: 10,
    },
    enabled: true,
  },
  { attribute: "email", weight: 20, scoreFnType: "presence", params: { present: 80, absent: 10 }, enabled: true },
];
