import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";

export const createStructureBody = z.object({
  name:        z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  isDefault:   z.boolean().default(false),
});
export type CreateStructureBody = z.infer<typeof createStructureBody>;

export const createRunBody = z.object({
  runNo:        z.string().min(1).max(64),
  month:        z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM"),
  departmentId: z.string().uuid().optional(),
  // Multi-DDO: scope a run to one DDO; employees are grouped by department->DDO.
  ddoCode:      z.string().min(1).max(32).optional(),
  // structureId is irrelevant for pensioner runs (pension uses the pensioner master).
  structureId:  z.string().uuid().optional(),
  runType:      z.enum(["regular", "supplementary", "arrears", "pensioner"]).optional(),
}).refine((b) => b.runType === "pensioner" || b.structureId != null, {
  message: "structureId is required for non-pensioner runs",
  path: ["structureId"],
});
export type CreateRunBody = z.infer<typeof createRunBody>;

// fix/high-data-issues: optional exact-month filter for GET /v1/payroll/runs
// so a caller that already knows the target period (e.g. the run detail
// page's month-over-month comparison) can ask for just that one row instead
// of paging through the tenant's whole run history to find it client-side.
export const listRunsQuery = listQuerySchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM").optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuery>;

export const idParam = z.object({ id: z.string().uuid() });

// Multi-DDO admin
export const createDdoBody = z.object({
  ddoCode: z.string().min(1).max(32),
  name:    z.string().min(1).max(200),
  // GAP-PAYROLL-DDOS-02: with a `reason`, this is the DDO's COMPLETE
  // department set -- departments no longer listed are unmapped (the web UI
  // always sends the full set plus a reason, and shows the diff). Without a
  // reason the list is add-only, as before, so an older client sending []
  // cannot wipe the mapping. Omitted = leave the mapping untouched.
  departmentIds: z.array(z.string().uuid()).max(500)
    .transform((ids) => [...new Set(ids)])
    .optional(),
  // Recorded on the audit event (before/after department sets).
  reason: z.string().trim().min(10).max(500).optional(),
});
export type CreateDdoBody = z.infer<typeof createDdoBody>;

// Pensioner master admin. Money is paise (bigint, sent as integer string/number).
// GAP-PAYROLL-PENSIONERS-NEW-01: was `z.union([z.string(), z.number()])
// .transform(BigInt)` -- BigInt("12.5") / BigInt("abc") threw a raw
// SyntaxError out of the transform (a 500, not a 400), and negatives passed.
// Now a whole, non-negative paise integer only.
const paise = z.union([
  z.string().regex(/^\d{1,15}$/, "must be a whole number of paise"),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]).transform((v) => BigInt(v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
/**
 * Today as YYYY-MM-DD in Asia/Kolkata (UTC+5:30, no DST) -- the same calendar
 * the web form uses (lib/formatters todayIST), so a date entered on the IST
 * morning before UTC midnight isn't rejected by one side only. ISO date
 * strings compare correctly as text.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;
const todayIso = (): string => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
// GAP-PAYROLL-PENSIONERS-NEW-02: format rules for the bank/PAN fields. The
// web form enforces the same rules client-side; the server must still check.
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const BANK_ACCOUNT_REGEX = /^\d{9,18}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const createPensionerBody = z.object({
  ppoNo:                 z.string().min(1).max(64),
  fullName:              z.string().min(1).max(200),
  dateOfBirth:           isoDate,
  // GAP-PAYROLL-PENSIONERS-NEW-01: a blank web field used to arrive as 0 and
  // create an "active" pensioner with a ₹0.00 basic pension.
  basicPensionMinor:     paise.refine((v) => v > 0n, "basic pension must be greater than zero"),
  commutedPensionMinor:  paise.optional(),
  commutationDate:       isoDate.optional(),
  medicalAllowanceMinor: paise.optional(),
  ddoCode:               z.string().min(1).max(32).optional(),
  bankAccountNo:         z.string().regex(BANK_ACCOUNT_REGEX, "bank account must be 9-18 digits").optional(),
  bankIfsc:              z.string().regex(IFSC_REGEX, "invalid IFSC").optional(),
  pan:                   z.string().regex(PAN_REGEX, "invalid PAN").optional(),
  taxRegime:             z.enum(["old", "new"]).default("new"),
}).superRefine((b, ctx) => {
  // GAP-PAYROLL-PENSIONERS-NEW-01: DOB must not be in the future.
  if (b.dateOfBirth > todayIso()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOfBirth"], message: "date of birth cannot be in the future" });
  }
  // GAP-PAYROLL-PENSIONERS-NEW-04: commuted amount and commutation date are a
  // pair -- both (amount > 0 and a date) or neither.
  const hasCommutedAmount = (b.commutedPensionMinor ?? 0n) > 0n;
  const hasCommutationDate = b.commutationDate !== undefined;
  if (hasCommutedAmount !== hasCommutationDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasCommutedAmount ? "commutationDate" : "commutedPensionMinor"],
      message: "commuted pension and commutation date must be given together",
    });
  }
  if (b.commutationDate !== undefined) {
    if (b.commutationDate < b.dateOfBirth) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["commutationDate"], message: "commutation date cannot be before date of birth" });
    }
    if (b.commutationDate > todayIso()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["commutationDate"], message: "commutation date cannot be in the future" });
    }
  }
});
export type CreatePensionerBody = z.infer<typeof createPensionerBody>;

export const slipQueryParams = z.object({
  runId: z.string().uuid().optional(),
});

// ─── CQRS lift (quality-payroll-95): arrears/bonus/reimbursements ──────────
// Hoisted out of world-class-routes.ts (were inline z.object literals) so
// commands.ts can share the exact same shape/types as the route validation —
// mirrors createDdoBody/createPensionerBody above.
// BUG-4 fix: oldAmountMinor/newAmountMinor are absolute salary-component
// amounts — like createEmployeeBody.basicMinor in hrms-service, they can
// never legitimately be negative — so both get the same .nonnegative()
// floor. The DELTA between them (newAmountMinor - oldAmountMinor, computed
// and persisted as difference_minor in consumer.ts's arrearCreate handler)
// is deliberately left unconstrained in sign: a back-dated pay DECREASE is
// a legitimate business case (demotion, correction of a prior overpayment)
// and must produce a negative delta so it is recovered, not paid out. This
// mirrors the codebase's own established pattern for the automatic
// retro-arrears generator (consumer.ts generateRetroArrears, "H1" comment),
// which explicitly treats a negative basicDelta as an ARREAR_RECOVERY, not
// as invalid input. Constraining the two inputs (not the result) is
// therefore the business-correct floor here.
export const createArrearBody = z.object({
  employeeId:     z.string().uuid(),
  componentCode:  z.string(),
  fromPeriod:     z.string(),
  toPeriod:       z.string(),
  oldAmountMinor: z.number().int().nonnegative(),
  newAmountMinor: z.number().int().nonnegative(),
  reason:         z.string().optional(),
});
export type CreateArrearBody = z.infer<typeof createArrearBody>;

// BUG-4 fix: basicMinor here is the salary base a bonus percentage is
// computed against (see consumer.ts bonusCompute: basicMinor * bonusPctBps).
// Unlike an arrear delta, there is no legitimate business case for a
// negative basic here, so the input itself gets the floor (no signed
// "result" to preserve, unlike createArrearBody above).
// round2 fix (regression re-test): bonusPct had no floor, unlike its sibling
// basicMinor above — a negative bonusPct (e.g. -8.33) survived to the
// consumer's bonusCompute handler and produced a negative bonus_amount_minor,
// which collectAdHocEarnings (payroll/consumer.ts) then feeds in as a
// negative "earning" line, bypassing the protected-net floor that only
// guards recognized deductions. Same floor, same rationale as basicMinor.
// GAP-PAYROLL-BONUS-03: the web form's 8.33-20 range (Payment of Bonus Act
// s.10 minimum / s.11 maximum) was enforced only by HTML min/max -- a
// cleared or scripted value reached this route unchecked. Same bounds here
// so the server is authoritative; at most 2 decimals so the consumer's
// bps conversion (Math.round(pct * 100)) is exact. fy is "YYYY-YY" with
// consecutive years (2025-26), the same shape every other payroll FY uses.
const BONUS_FY_RE = /^(\d{4})-(\d{2})$/;
export const computeBonusBody = z.object({
  employeeId: z.string().uuid(),
  fy:         z.string().regex(BONUS_FY_RE).refine((fy) => {
    const m = BONUS_FY_RE.exec(fy);
    return !!m && Number(m[2]) === (Number(m[1]) + 1) % 100;
  }, "fy must be consecutive years, e.g. 2025-26"),
  basicMinor: z.number().int().nonnegative(),
  bonusPct:   z.number().min(8.33).max(20)
    .refine((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-9, "bonusPct allows at most 2 decimals")
    .default(8.33),
  // GAP-PAYROLL-BONUS-02: why the basic differs from the HRMS value the form prefilled (audited, never part of the amount).
  overrideReason: z.string().trim().min(5).max(256).optional(),
});
export type ComputeBonusBody = z.infer<typeof computeBonusBody>;

export const createReimbursementBody = z.object({
  employeeId:  z.string().uuid(),
  category:    z.enum(["medical", "travel", "lta", "food", "telephone", "internet", "fuel", "other"]),
  amountMinor: z.number().int().positive(),
  billDate:    z.string().optional(),
  billRef:     z.string().max(128).optional(),
  // GAP-PAYROLL-REIMBURSEMENTS-04: a real calendar month (2026-13 was
  // accepted), same "YYYY-MM" the payroll run compares against.
  period:      z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM"),
});
export type CreateReimbursementBody = z.infer<typeof createReimbursementBody>;

// GAP-PAYROLL-REIMBURSEMENTS-02: approve takes an optional note; reject
// requires a reason (it is the only record of why the claimant was refused).
export const reimbursementDecisionBody = z.object({
  reason: z.string().trim().max(512).optional(),
});
export const reimbursementRejectBody = z.object({
  reason: z.string().trim().min(10).max(512),
});

// ─── F3 leftover CQRS: salary revisions / settings ─────────────────────────
// Hoisted out of world-class-routes.ts (were inline z.object literals) so
// commands.ts can share the exact same shape/types as the route validation —
// mirrors createArrearBody/computeBonusBody/createReimbursementBody above.
export const createSalaryRevisionBody = z.object({
  employeeId:    z.string().uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  oldBasicMinor: z.number().int().nonnegative(),
  newBasicMinor: z.number().int().positive(),
  oldGrossMinor: z.number().int().nonnegative(),
  newGrossMinor: z.number().int().positive(),
  revisionType:  z.enum(["annual_increment", "promotion", "correction", "fitment"]).default("annual_increment"),
  // GAP-PAYROLL-SALARY-REVISIONS-02: a revision rewrites HRMS basic pay, so it must cite its sanctioning order.
  orderNo:       z.string().trim().min(1).max(64),
});
export type CreateSalaryRevisionBody = z.infer<typeof createSalaryRevisionBody>;

const bps = z.number().int().min(0).max(10000);
export const updateSettingsBody = z.object({
  protectedNetFloorMinor: z.number().int().nonnegative(),
  // FR 53 subsistence allowance (migration 0057). Optional: omitted fields
  // keep their current value (FR 53 defaults on a tenant's first save).
  subsistenceInitialPctBps: bps.optional(),
  subsistenceReviewAfterDays: z.number().int().min(1).max(366).optional(),
  subsistenceRevisedMinPctBps: bps.optional(),
  subsistenceRevisedMaxPctBps: bps.optional(),
  // GAP-PAYROLL-FLEX-BENEFITS-05 (migration 0070): maker-checker on flex-benefit
  // election approval. Optional: omitted keeps the stored value (default ON).
  flexElectionMakerChecker: z.boolean().optional(),
}).refine(
  (b) => b.subsistenceRevisedMinPctBps == null || b.subsistenceRevisedMaxPctBps == null
    || b.subsistenceRevisedMinPctBps <= b.subsistenceRevisedMaxPctBps,
  { message: "subsistenceRevisedMinPctBps must not exceed subsistenceRevisedMaxPctBps", path: ["subsistenceRevisedMinPctBps"] },
);
export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>;

/**
 * GAP-PAYROLL-PAY-GROUPS-04: a pay group's timezone drives pay-day cut-offs,
 * so only a real IANA zone name is accepted ("Mars/Base" used to be stored).
 */
export function isValidIanaTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
