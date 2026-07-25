import { z } from "zod";

const FY = z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY");

export const createOutcomeBody = z.object({
  headId:         z.string().uuid(),
  fy:             FY,
  allocationId:   z.string().uuid().optional(),
  schemeId:       z.string().uuid().optional(),
  outputDesc:     z.string().min(3).max(500),
  outcomeDesc:    z.string().min(3).max(500),
  indicator:      z.string().min(1).max(200),
  unit:           z.string().min(1).max(40),
  baselineValue:  z.number().int().nonnegative().default(0),
  targetValue:    z.number().int().positive(),
  allocatedMinor: z.number().int().nonnegative().default(0),
  currency:       z.string().length(3).default("INR"),
  effectiveFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateOutcomeBody = z.infer<typeof createOutcomeBody>;

export const recordAchievementBody = z.object({
  achievedValue: z.number().int().nonnegative(),
});
export type RecordAchievementBody = z.infer<typeof recordAchievementBody>;

export const evaluateOutcomeBody = z.object({
  note: z.string().min(3).max(1000),
});
export type EvaluateOutcomeBody = z.infer<typeof evaluateOutcomeBody>;

export const outcomeQuery = z.object({
  fy:     FY.optional(),
  headId: z.string().uuid().optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
});

export const idParam = z.object({ id: z.string().uuid() });
