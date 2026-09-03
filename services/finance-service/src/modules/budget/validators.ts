import { z } from "zod";
import { zMoneyMinor as zMoneyMinorBase } from "@civitasone/schemas/money";
import { PFMS_HOA_REGEX } from "../../shared/pfms.js";

export const updateHeadHoABody = z.object({
  hoaCode: z.string().regex(PFMS_HOA_REGEX, "HoA must be exactly 18 numeric digits (PFMS format)"),
});
export type UpdateHeadHoABody = z.infer<typeof updateHeadHoABody>;

// BUG FIX: bigint-safe money fields, matching payments/validators.ts's
// createBillBody.grossMinor pattern. Confirmed live: a 17-digit amountMinor
// sent to createSanctionBody (below) was silently accepted and persisted
// 1 paisa off from what was sent — z.number() loses precision above 2^53 at
// the JSON.parse boundary, before Zod ever runs, and z.number().int() still
// accepts the (already wrong) rounded result since it's still an integer.
// FIX: was a hand-rolled union missing a z.number() branch, so any plain
// JSON-number payload (the common case) 400'd. zMoneyMinorBase is the
// canonical @civitasone/schemas/money decoder — accepts string | safe-integer
// number | bigint and rejects unsafe (>2^53) numbers, forcing those onto the
// string path instead of silently losing precision.
const moneyMinorField = zMoneyMinorBase.pipe(z.bigint().positive());
const moneyMinorFieldNonNeg = zMoneyMinorBase.pipe(z.bigint().nonnegative());

export const createBudgetBody = z.object({
  headId:   z.string().uuid(),
  fy:       z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY"),
  beMinor:  moneyMinorFieldNonNeg,
});
export type CreateBudgetBody = z.infer<typeof createBudgetBody>;

export const reappropriateBody = z.object({
  fromBudgetId: z.string().uuid(),
  amountMinor:  moneyMinorField,
  reason:       z.string().min(3).max(500),
});
export type ReappropriateBody = z.infer<typeof reappropriateBody>;

export const createSanctionBody = z.object({
  sanctionNo:  z.string().min(1).max(64),
  purpose:     z.string().min(3).max(500),
  headId:      z.string().uuid(),
  amountMinor: moneyMinorField,
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
  amountMinor:  moneyMinorField,
  reason:       z.string().min(3).max(500),
});
export type SubmitReappropriationBody = z.infer<typeof submitReappropriationBody>;

export const idParam = z.object({ id: z.string().uuid() });
