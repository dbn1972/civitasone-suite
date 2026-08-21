import { z } from "zod";

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

export const idParam = z.object({ id: z.string().uuid() });

// Multi-DDO admin
export const createDdoBody = z.object({
  ddoCode: z.string().min(1).max(32),
  name:    z.string().min(1).max(200),
  departmentIds: z.array(z.string().uuid()).default([]),
});
export type CreateDdoBody = z.infer<typeof createDdoBody>;

// Pensioner master admin. Money is paise (bigint, sent as integer string/number).
const paise = z.union([z.string(), z.number()]).transform((v) => BigInt(v));
export const createPensionerBody = z.object({
  ppoNo:                 z.string().min(1).max(64),
  fullName:              z.string().min(1).max(200),
  dateOfBirth:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  basicPensionMinor:     paise,
  commutedPensionMinor:  paise.optional(),
  commutationDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  medicalAllowanceMinor: paise.optional(),
  ddoCode:               z.string().min(1).max(32).optional(),
  bankAccountNo:         z.string().max(64).optional(),
  bankIfsc:              z.string().max(16).optional(),
  pan:                   z.string().max(16).optional(),
  taxRegime:             z.enum(["old", "new"]).default("new"),
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
export const computeBonusBody = z.object({
  employeeId: z.string().uuid(),
  fy:         z.string(),
  basicMinor: z.number().int().nonnegative(),
  bonusPct:   z.number().nonnegative().default(8.33),
});
export type ComputeBonusBody = z.infer<typeof computeBonusBody>;

export const createReimbursementBody = z.object({
  employeeId:  z.string().uuid(),
  category:    z.enum(["medical", "travel", "lta", "food", "telephone", "internet", "fuel", "other"]),
  amountMinor: z.number().int().positive(),
  billDate:    z.string().optional(),
  billRef:     z.string().optional(),
  period:      z.string(),
});
export type CreateReimbursementBody = z.infer<typeof createReimbursementBody>;
