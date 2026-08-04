/** LQ-002 zod validators — configurable scoring rules + score-history query. */
import { z } from "zod";

export const scoreFnTypeEnum = z.enum(["presence", "map", "recency", "numeric_threshold"]);

export const scoreRuleSchema = z.object({
  attribute: z.string().min(1).max(64),
  weight: z.number().int().min(0).max(100),
  scoreFnType: scoreFnTypeEnum,
  params: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const putScoreRulesBody = z.object({
  rules: z.array(scoreRuleSchema).min(1).max(20),
});
export type PutScoreRulesBody = z.infer<typeof putScoreRulesBody>;

export const scoreHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const leadIdParam = z.object({ id: z.string().uuid() });
