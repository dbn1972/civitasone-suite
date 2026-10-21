/** LQ-002 zod validators — configurable scoring rules + score-history query. */
import { z } from "zod";
import { isScoreableAttribute } from "./score-rules-domain.js";

export const scoreFnTypeEnum = z.enum(["presence", "map", "recency", "numeric_threshold"]);

/**
 * GAP-CRM-LEAD-SCORING-02: the params contract of each score function, enforced here so a
 * direct API call cannot save what buildScoreFn (score-rules-domain.ts) would choke on. A
 * stored `{ "tiers": 5 }` makes buildScoreFn throw (`.slice` on a number), which aborts every
 * lead recalculation and every preview for the tenant until an admin repairs the rule. The web
 * editor checks the same contract field by field (apps/web/src/lib/crm/leadScoreParams.ts),
 * but the backend is authoritative.
 *
 * What buildScoreFn reads, per kind:
 *   presence          { present, absent }
 *   map               { values: { <lower-case value>: score }, default }
 *   recency           { tiers: [{ maxDays, score }], beyondScore, absentScore }
 *   numeric_threshold { tiers: [{ min, score }], default }
 * Every score is clamped to 0-100 by the scorer, so an out-of-range score is rejected here
 * instead of being silently clamped. Keys the scorer does not read pass through untouched.
 */
const SCORE_MESSAGE = "must be a number from 0 to 100";
// One refinement (not .finite().min().max()), so an out-of-range value is ONE field error;
// Infinity (JSON `1e999`) fails the range, NaN is not a number.
const scoreValue = z
  .number({ invalid_type_error: SCORE_MESSAGE })
  .refine((n) => n >= 0 && n <= 100, SCORE_MESSAGE);

/** The scorer lower-cases the lead value before looking it up, so an upper-case key can never match. */
const lowerCaseKeys = (values: Record<string, unknown>, ctx: z.RefinementCtx): void => {
  for (const key of Object.keys(values)) {
    if (key !== key.toLowerCase()) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "map keys must be lower-case: the lead value is lower-cased before it is matched",
      });
    }
  }
};

const DAYS_MESSAGE = "must be a number of days, 0 or more";

const presenceParams = z
  .object({ present: scoreValue.optional(), absent: scoreValue.optional() })
  .passthrough();

const mapParams = z
  .object({
    values: z.record(scoreValue).superRefine(lowerCaseKeys).optional(),
    default: scoreValue.optional(),
  })
  .passthrough();

const recencyParams = z
  .object({
    tiers: z
      .array(
        z
          .object({
            maxDays: z.number({ invalid_type_error: DAYS_MESSAGE }).refine((n) => n >= 0 && Number.isFinite(n), DAYS_MESSAGE),
            score: scoreValue,
          })
          .passthrough(),
      )
      .optional(),
    beyondScore: scoreValue.optional(),
    absentScore: scoreValue.optional(),
    default: scoreValue.optional(),
  })
  .passthrough();

const numericThresholdParams = z
  .object({
    tiers: z
      .array(
        z
          .object({
            min: z.number({ invalid_type_error: "must be a number" }).finite("must be a number"),
            score: scoreValue,
          })
          .passthrough(),
      )
      .optional(),
    default: scoreValue.optional(),
  })
  .passthrough();

const ruleBase = {
  // GAP-CRM-LEAD-SCORING-03: only a field the scorer really evaluates (an unknown
  // attribute would be saved but never score anything).
  attribute: z.string().min(1).max(64).refine(isScoreableAttribute, {
    message: "attribute is not a scoreable lead field",
  }),
  weight: z.number().int().min(0).max(100),
  enabled: z.boolean().default(true),
};

/**
 * Discriminated on scoreFnType so each kind's params are checked against its own contract;
 * a violation answers 400 with a field error on `rules.<i>.params...`.
 */
export const scoreRuleSchema = z.discriminatedUnion("scoreFnType", [
  z.object({ ...ruleBase, scoreFnType: z.literal("presence"), params: presenceParams.default({}) }),
  z.object({ ...ruleBase, scoreFnType: z.literal("map"), params: mapParams.default({}) }),
  z.object({ ...ruleBase, scoreFnType: z.literal("recency"), params: recencyParams.default({}) }),
  z.object({ ...ruleBase, scoreFnType: z.literal("numeric_threshold"), params: numericThresholdParams.default({}) }),
]);

/**
 * The backend keeps ONE rule per (tenant, attribute): a second entry for the same attribute
 * in one request would silently overwrite the first on save (and be scored twice by a
 * naive preview), so it is rejected as a field error on the repeated entry.
 */
const scoreRuleList = z
  .array(scoreRuleSchema)
  .max(20)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((rule, index) => {
      if (seen.has(rule.attribute)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "attribute"],
          message: "attribute is used by more than one rule; each lead field can have one rule",
        });
      }
      seen.add(rule.attribute);
    });
  });

export const putScoreRulesBody = z.object({
  // F3-03 empty-config guard: an empty list reaches the ROUTE (which answers 422
  // EMPTY_CONFIG_REJECTED unless ?confirmEmpty=true) instead of a generic 400.
  rules: scoreRuleList,
  // GAP-CRM-LEAD-SCORING-05: optional list-level optimistic-concurrency token.
  // Also accepted via the If-Match header; the header takes precedence.
  version: z.string().min(1).optional(),
});
export type PutScoreRulesBody = z.infer<typeof putScoreRulesBody>;

/** GAP-CRM-LEAD-SCORING-04: dry-run of a proposed rule set (nothing is saved). */
export const previewScoreRulesBody = z.object({
  rules: scoreRuleList,
});

export const scoreHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const leadIdParam = z.object({ id: z.string().uuid() });
