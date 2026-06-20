import { z } from "zod";

export const createBudgetBody = z.object({
  headId:   z.string().uuid(),
  fy:       z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY"),
  beMinor:  z.number().int().nonnegative(),
});
export type CreateBudgetBody = z.infer<typeof createBudgetBody>;

export const reappropriateBody = z.object({
  reMinor: z.number().int().nonnegative(),
  reason:  z.string().min(3).max(500),
});
export type ReappropriateBody = z.infer<typeof reappropriateBody>;

export const createSanctionBody = z.object({
  sanctionNo:  z.string().min(1).max(64),
  purpose:     z.string().min(3).max(500),
  headId:      z.string().uuid(),
  amountMinor: z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
});
export type CreateSanctionBody = z.infer<typeof createSanctionBody>;

export const budgetQueryParams = z.object({
  headId: z.string().uuid().optional(),
  fy:     z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
export type BudgetQueryParams = z.infer<typeof budgetQueryParams>;

export const idParam = z.object({ id: z.string().uuid() });
