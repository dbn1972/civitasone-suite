import { z } from "zod";

const FY = z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY");

export const createSupplementaryBody = z.object({
  fy:            FY,
  budgetId:      z.string().uuid(),
  headId:        z.string().uuid(),
  amountMinor:   z.number().int().positive(),
  limitMinor:    z.number().int().nonnegative().default(0),
  kind:          z.enum(["supplementary", "additional", "excess"]).default("supplementary"),
  authority:     z.string().min(1).max(500),
  reason:        z.string().min(3).max(1000),
  currency:      z.string().length(3).default("INR"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateSupplementaryBody = z.infer<typeof createSupplementaryBody>;

export const rejectSupplementaryBody = z.object({
  reason: z.string().min(3).max(1000),
});
export type RejectSupplementaryBody = z.infer<typeof rejectSupplementaryBody>;

export const supplementaryQuery = z.object({
  fy:       FY.optional(),
  status:   z.string().max(24).optional(),
  budgetId: z.string().uuid().optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(100),
});

export const idParam = z.object({ id: z.string().uuid() });
