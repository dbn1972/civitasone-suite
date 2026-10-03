/**
 * POST /v1/payroll/statutory/state-rules -- request contract (LWF).
 *
 * GAP-PAYROLL-STATUTORY-PT-04: professional-tax slabs are no longer written
 * here. They are effective-dated, immutable versions created through
 * POST /v1/payroll/statutory/pt/versions (pt-versions-routes.ts); this body
 * carries no PT fields, and the route refuses a body that still has `ptSlabs`.
 *
 * GAP-PAYROLL-STATUTORY-LWF-02: LWF frequency is settable. When a field is
 * omitted the stored value is preserved (the consumer COALESCEs), so a POST
 * that only carries the contribution amounts can no longer reset the
 * frequency or zero the other party's contribution.
 */
import { z } from "zod";

export const LWF_FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export type LwfFrequency = (typeof LWF_FREQUENCIES)[number];

/**
 * GAP-PAYROLL-STATUTORY-PT-04: the states / UTs a PT or LWF rule can be
 * keyed on -- ISO 3166-2:IN subdivision codes, plus the legacy codes still in
 * common use (OR = Odisha, DN/DD = the two UTs merged into DH in 2020,
 * UT/UK = Uttarakhand). Anything else ("ZZ") is rejected at the boundary.
 */
export const INDIAN_STATE_UT_CODES = [
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DH", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL",
  "LA", "LD", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PB", "PY", "RJ", "SK", "TN", "TS", "TR", "UP",
  "UK", "WB",
  "OR", "DN", "DD", "UT",
] as const;
const STATE_CODE_SET: ReadonlySet<string> = new Set(INDIAN_STATE_UT_CODES);

export const stateRulesBody = z.object({
  stateCode: z.string().trim().toUpperCase().min(2).max(4)
    .refine((c) => STATE_CODE_SET.has(c), "must be an Indian state / UT code, e.g. KA"),
  lwfEmployee: z.number().int().nonnegative().optional(),
  lwfEmployer: z.number().int().nonnegative().optional(),
  lwfFrequency: z.enum(LWF_FREQUENCIES).optional(),
});
export type StateRulesBody = z.infer<typeof stateRulesBody>;
