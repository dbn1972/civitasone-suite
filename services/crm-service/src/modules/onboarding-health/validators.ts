/**
 * Onboarding health metric validators (G19).
 *
 * Zod schemas for route input validation. Kept in a separate file so the route
 * module stays focused on request handling and this can be shared with tests.
 */
import { z } from "zod";

/** Allowed milestone event identifiers. Extensible per tenant but validated for format. */
const milestoneEventPattern = /^[a-z][a-z0-9_]{1,62}[a-z0-9]$/;

export const createHealthRuleBody = z.object({
  ruleKey: z
    .string()
    .min(2)
    .max(64)
    .regex(milestoneEventPattern, "rule_key must be lowercase alphanumeric with underscores"),
  milestoneEvent: z
    .string()
    .min(2)
    .max(64)
    .regex(milestoneEventPattern, "milestone_event must be lowercase alphanumeric with underscores"),
  expectedWithinDays: z.number().int().min(1).max(365),
  weight: z.number().int().min(0).max(100).default(50),
  active: z.boolean().default(true),
});

export const updateHealthRuleBody = z.object({
  milestoneEvent: z
    .string()
    .min(2)
    .max(64)
    .regex(milestoneEventPattern, "milestone_event must be lowercase alphanumeric with underscores")
    .optional(),
  expectedWithinDays: z.number().int().min(1).max(365).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
  version: z.number().int().min(1),
});

export const idParam = z.object({ id: z.string().uuid() });
export const caseIdParam = z.object({ caseId: z.string().uuid() });

export type CreateHealthRuleInput = z.infer<typeof createHealthRuleBody>;
export type UpdateHealthRuleInput = z.infer<typeof updateHealthRuleBody>;
