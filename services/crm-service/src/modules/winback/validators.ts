/**
 * winback/validators.ts — Zod schemas for route-boundary validation.
 */
import { z } from "zod";

const triggerCriteriaSchema = z.object({
  inactiveDays: z.number().int().min(0).optional(),
  declinePct: z.number().min(0).max(100).optional(),
  hasRecentComplaint: z.boolean().optional(),
}).refine(
  (c) => c.inactiveDays !== undefined || c.declinePct !== undefined || c.hasRecentComplaint !== undefined,
  { message: "At least one trigger criterion must be specified" },
);

const cadenceStepSchema = z.object({
  ordinal: z.number().int().min(0),
  delayDays: z.number().int().min(0),
  actionType: z.string().min(1).max(64),
  templateRef: z.string().max(255).optional(),
});

export const createCadenceBody = z.object({
  name: z.string().min(1).max(120),
  triggerCriteria: triggerCriteriaSchema,
  steps: z.array(cadenceStepSchema).min(1).max(50),
  status: z.enum(["draft", "active"]).optional().default("draft"),
});

export const updateCadenceBody = z.object({
  name: z.string().min(1).max(120).optional(),
  triggerCriteria: triggerCriteriaSchema.optional(),
  steps: z.array(cadenceStepSchema).min(1).max(50).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export const enrollAccountBody = z.object({
  cadenceId: z.string().uuid(),
  accountId: z.string().uuid(),
});

export const recordOutcomeBody = z.object({
  outcome: z.enum(["converted", "churned", "no_response"]),
});

export type CreateCadenceInput = z.infer<typeof createCadenceBody>;
export type UpdateCadenceInput = z.infer<typeof updateCadenceBody>;
export type EnrollAccountInput = z.infer<typeof enrollAccountBody>;
export type RecordOutcomeInput = z.infer<typeof recordOutcomeBody>;
