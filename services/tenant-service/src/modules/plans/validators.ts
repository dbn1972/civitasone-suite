/** zod validators — applied at the route boundary. */
import { z } from "zod";

export const editionValues = ["small_office", "psu", "govt_dept"] as const;
export const billingCycleValues = ["monthly", "quarterly", "annual"] as const;

export const createPlanBody = z.object({
  code: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/, "lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(2).max(200),
  edition: z.enum(editionValues),
  maxUsers: z.number().int().min(1).max(1_000_000),
  maxStorageGb: z.number().int().min(1).max(100_000),
  enabledModules: z.array(z.string().min(1).max(64)).default([]),
  priceMinor: z.number().int().min(0),
  billingCycle: z.enum(billingCycleValues).default("annual"),
  features: z.record(z.unknown()).default({}),
});
export type CreatePlanBody = z.infer<typeof createPlanBody>;

export const updatePlanBody = z.object({
  name: z.string().min(2).max(200).optional(),
  maxUsers: z.number().int().min(1).max(1_000_000).optional(),
  maxStorageGb: z.number().int().min(1).max(100_000).optional(),
  enabledModules: z.array(z.string().min(1).max(64)).optional(),
  priceMinor: z.number().int().min(0).optional(),
  billingCycle: z.enum(billingCycleValues).optional(),
  features: z.record(z.unknown()).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), {
  message: "at least one field must be provided",
});
export type UpdatePlanBody = z.infer<typeof updatePlanBody>;

export const planIdParam = z.object({ planId: z.string().uuid() });
