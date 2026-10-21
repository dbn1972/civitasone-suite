/** LQ-002 zod validators — configurable scoring rules + score-history query. */
import { z } from "zod";
import { isScoreableAttribute } from "./score-rules-domain.js";

export const scoreFnTypeEnum = z.enum(["presence", "map", "recency", "numeric_threshold"]);

export const scoreRuleSchema = z.object({
  // GAP-CRM-LEAD-SCORING-03: only a field the scorer really evaluates (an unknown
  // attribute would be saved but never score anything).
  attribute: z.string().min(1).max(64).refine(isScoreableAttribute, {
    message: "attribute is not a scoreable lead field",
  }),
  weight: z.number().int().min(0).max(100),
  scoreFnType: scoreFnTypeEnum,
  params: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const putScoreRulesBody = z.object({
  // F3-03 empty-config guard: an empty list reaches the ROUTE (which answers 422
  // EMPTY_CONFIG_REJECTED unless ?confirmEmpty=true) instead of a generic 400.
  rules: z.array(scoreRuleSchema).max(20),
  // GAP-CRM-LEAD-SCORING-05: optional list-level optimistic-concurrency token.
  // Also accepted via the If-Match header; the header takes precedence.
  version: z.string().min(1).optional(),
});
export type PutScoreRulesBody = z.infer<typeof putScoreRulesBody>;

/** GAP-CRM-LEAD-SCORING-04: dry-run of a proposed rule set (nothing is saved). */
export const previewScoreRulesBody = z.object({
  rules: z.array(scoreRuleSchema).max(20),
});

export const scoreHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const leadIdParam = z.object({ id: z.string().uuid() });
