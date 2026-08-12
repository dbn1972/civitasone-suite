import { z } from "zod";

export const createSchemeBody = z.object({
  code:                   z.string().min(1).max(32),
  name:                   z.string().min(3).max(256),
  sanctionRef:            z.string().optional(),
  budgetMinor:            z.number().int().nonnegative(),
  minAmountMinor:         z.number().int().nonnegative().default(0),
  maxAmountMinor:         z.number().int().nonnegative(),
  currency:               z.string().length(3).default("INR"),
  openAt:                 z.string().datetime().optional(),
  closeAt:                z.string().datetime().optional(),
  /** Quarterly = 90, Half-yearly = 180, Annual = 365. Required for compliance monitoring. */
  reportingFrequencyDays: z.number().int().positive().optional(),
});
export type CreateSchemeBody = z.infer<typeof createSchemeBody>;

export const updateSchemeBody = z.object({
  name:                   z.string().min(3).max(256).optional(),
  sanctionRef:            z.string().optional(),
  budgetMinor:            z.number().int().nonnegative().optional(),
  maxAmountMinor:         z.number().int().nonnegative().optional(),
  openAt:                 z.string().datetime().optional(),
  closeAt:                z.string().datetime().optional(),
  reportingFrequencyDays: z.number().int().positive().optional(),
}).refine(
  (body) => Object.keys(body).length > 0,
  { message: "at least one field must be provided to update" }
);
export type UpdateSchemeBody = z.infer<typeof updateSchemeBody>;

export const createCriterionBody = z.object({
  criterionKey:  z.enum(["age", "income", "category", "geography"]),
  minValue:      z.string().optional(),
  maxValue:      z.string().optional(),
  allowedValues: z.array(z.string()).optional(),
  description:   z.string().optional(),
});
export type CreateCriterionBody = z.infer<typeof createCriterionBody>;

export const idParam = z.object({ id: z.string().uuid() });
