import { z } from "zod";
import { PFMS_HOA_REGEX } from "../../shared/pfms.js";

export const updateHeadHoABody = z.object({
  hoaCode: z.string().regex(PFMS_HOA_REGEX, "HoA must be exactly 18 numeric digits (PFMS format)"),
});
export type UpdateHeadHoABody = z.infer<typeof updateHeadHoABody>;

export const createBudgetBody = z.object({
  headId:   z.string().uuid(),
  fy:       z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY"),
  beMinor:  z.number().int().nonnegative(),
});
export type CreateBudgetBody = z.infer<typeof createBudgetBody>;

export const reappropriateBody = z.object({
  fromBudgetId: z.string().uuid(),
  amountMinor:  z.number().int().positive(),
  reason:       z.string().min(3).max(500),
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

export const rejectSanctionBody = z.object({
  reason: z.string().min(3).max(500),
});
export type RejectSanctionBody = z.infer<typeof rejectSanctionBody>;

/**
 * Submit a budget re-appropriation to eOffice for administrative approval.
 * Creates the re-appropriation request (status pending_approval); the route
 * `:id` becomes the request id / eFile refId. The transfer moves `amountMinor`
 * (paise) FROM `fromBudgetId`'s savings TO `toBudgetId` on approval — a
 * zero-sum transfer (GFR Rule 10), applied by the eOffice decision callback.
 */
export const submitReappropriationBody = z.object({
  fromBudgetId: z.string().uuid(),
  toBudgetId:   z.string().uuid(),
  headId:       z.string().uuid().optional(),
  amountMinor:  z.number().int().positive(),
  reason:       z.string().min(3).max(500),
});
export type SubmitReappropriationBody = z.infer<typeof submitReappropriationBody>;

export const idParam = z.object({ id: z.string().uuid() });
