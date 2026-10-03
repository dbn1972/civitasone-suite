import { GRATUITY_CEILING_PAISE, GRATUITY_DAYS, WORKING_DAYS_PER_MONTH } from "./constants";
import { completedServiceYears } from "./serviceYears";

/**
 * GAP-PAYROLL-STATUTORY-GRATUITY-01/04: the gratuity rule set in force for the
 * tenant, as returned by GET /v1/payroll/statutory/gratuity/rules (`resolved`).
 * Mirrors payroll-service gratuity-rules/rules.ts (the server is authoritative;
 * this is only the estimator's copy of the same formula):
 *  - pog_act  : Payment of Gratuity Act, 1972 s.4(2) -- 15/26 x wages x completed years
 *               (a part year over six months counts as a year), ceiling per s.4(3).
 *  - ccs_dcrg : CCS (Pension) Rules DCRG -- 1/4 x emoluments x completed six-monthly
 *               periods, at most 66 periods and 16.5 x emoluments, then the ceiling.
 * VERIFY the clause numbers and the Rs 25 lakh DCRG ceiling with the pension owner.
 */
export type GratuityRuleSet = "pog_act" | "ccs_dcrg";

export interface GratuityRuleView {
  ruleSet: GratuityRuleSet;
  minServiceYears: number;
  /** paise, as a digit string (bigint-safe over the wire). */
  ceilingMinor: string;
  source: "tenant" | "default";
}

/** No rule loaded (or none configured): today's Payment of Gratuity Act behaviour. */
export const DEFAULT_GRATUITY_RULE: GratuityRuleView = {
  ruleSet: "pog_act",
  minServiceYears: 5,
  ceilingMinor: String(GRATUITY_CEILING_PAISE),
  source: "default",
};

const MAX_HALF_YEARS = 66n;

export function isGratuityRuleView(v: unknown): v is GratuityRuleView {
  const r = v as Partial<GratuityRuleView> | null;
  return !!r
    && (r.ruleSet === "pog_act" || r.ruleSet === "ccs_dcrg")
    && typeof r.minServiceYears === "number"
    && typeof r.ceilingMinor === "string" && /^\d+$/.test(r.ceilingMinor);
}

export interface GratuityEstimate {
  /** completed years (pog_act) or completed six-monthly periods (ccs_dcrg) */
  units: number;
  perUnitMinor: bigint;
  rawMinor: bigint;
  minor: bigint;
  capped: boolean;
  ceilingMinor: bigint;
}

export function estimateGratuity(rule: GratuityRuleView, years: number, salaryMinor: bigint): GratuityEstimate {
  const ceilingMinor = BigInt(rule.ceilingMinor);
  if (rule.ruleSet === "ccs_dcrg") {
    const half = BigInt(Math.max(0, Math.floor(years * 2 + 1e-9)));
    const periods = half > MAX_HALF_YEARS ? MAX_HALF_YEARS : half;
    let raw = (salaryMinor * periods) / 4n;
    const max165 = (salaryMinor * 33n) / 2n;
    if (raw > max165) raw = max165;
    const minor = raw > ceilingMinor ? ceilingMinor : raw;
    return { units: Number(periods), perUnitMinor: salaryMinor / 4n, rawMinor: raw, minor, capped: raw > ceilingMinor, ceilingMinor };
  }
  const completed = completedServiceYears(years);
  // One division at the end, so no per-year truncation drift (see GRATUITY-05).
  const raw = (salaryMinor * BigInt(GRATUITY_DAYS) * BigInt(completed)) / BigInt(WORKING_DAYS_PER_MONTH);
  const perYear = (salaryMinor * BigInt(GRATUITY_DAYS)) / BigInt(WORKING_DAYS_PER_MONTH);
  const minor = raw > ceilingMinor ? ceilingMinor : raw;
  return { units: completed, perUnitMinor: perYear, rawMinor: raw, minor, capped: raw > ceilingMinor, ceilingMinor };
}
