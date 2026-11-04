/**
 * UAT b18 D1 / D3 (EPF for contract staff, 2026-11-05): pension scheme rules.
 * Pure -- no I/O. Used by employee create, the maker-checker change routes
 * (pension-scheme-routes.ts), the worker tick and the payroll-input feed.
 */

/** Schemes a change can move an employee TO (and that payroll computes). */
export const PENSION_SCHEMES = ["GPF", "NPS", "EPF", "UPS"] as const;
export type PensionScheme = (typeof PENSION_SCHEMES)[number];

/** The New Pension System applies to central government appointments on/after 1 Jan 2004 (GPF before it). */
export const NPS_START_DATE = "2004-01-01";

/**
 * Engagement types whose staff are EPF members (EPF & MP Act, 1952), never
 * GPF / NPS: contract staff (owner decision 2026-11-05: EPF for contract
 * staff) and PSU employees. Matched case-insensitively against employeeType.
 */
export const EPF_ENGAGEMENT_TYPES: ReadonlySet<string> = new Set(["contract", "contractual", "psu"]);

/**
 * Default scheme at hire, by rule (it used to be the column default NPS for
 * everyone, contract staff included):
 *   - contract / contractual / PSU employee types  -> EPF (any joining date;
 *     GPF and NPS are government-servant schemes, contract and PSU staff are
 *     never on them)
 *   - otherwise joined before 2004-01-01            -> GPF
 *   - otherwise                                     -> NPS (UPS can be chosen
 *     explicitly at hire or later through a scheme change)
 */
export function defaultPensionScheme(input: { dateOfJoining: string; employeeType?: string | null }): PensionScheme {
  const type = (input.employeeType ?? "").trim().toLowerCase();
  if (EPF_ENGAGEMENT_TYPES.has(type)) return "EPF";
  if (input.dateOfJoining < NPS_START_DATE) return "GPF";
  return "NPS";
}

/** A UAN (EPFO Universal Account Number) is exactly 12 digits. */
export function isValidUan(uan: string | null | undefined): boolean {
  return typeof uan === "string" && /^\d{12}$/.test(uan);
}

/**
 * Missing statutory identifiers for the scheme the employee is on. An EPF
 * member without a valid UAN is INCOMPLETE: the ECR export refuses to run
 * for them (payroll-service, 422 UAN_MISSING) until the UAN is recorded.
 */
export function statutoryIncomplete(emp: { pensionScheme: string | null; uanNumber: string | null }): string[] {
  return emp.pensionScheme === "EPF" && !isValidUan(emp.uanNumber) ? ["UAN_MISSING"] : [];
}

/** YYYY-MM-01 for a YYYY-MM month. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

export interface ApprovedSchemeChange {
  fromScheme: string;
  toScheme: string;
  effectiveFrom: string; // YYYY-MM-01
}

/**
 * The scheme IN EFFECT for a wage month: the latest approved change effective
 * on/before the first of that month; before the first approved change, that
 * change's from-scheme (so historical periods keep the old scheme); with no
 * approved change at all, the employee's recorded scheme.
 */
export function schemeForMonth(current: string, approved: readonly ApprovedSchemeChange[], month: string): string {
  if (approved.length === 0) return current;
  const sorted = [...approved].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  const start = monthStart(month);
  let inEffect: string | null = null;
  for (const c of sorted) if (c.effectiveFrom <= start) inEffect = c.toScheme;
  return inEffect ?? sorted[0]!.fromScheme;
}

/**
 * Wage months (YYYY-MM) from `effectiveFrom` up to and including the month
 * before `todayIso`'s month: the periods a back-dated change reaches that may
 * already have been paid under the old scheme. Their slips are NOT changed;
 * the difference is reported (payroll /reports/pension-scheme-retro).
 */
export function retroPeriods(effectiveFrom: string, todayIso: string): string[] {
  const out: string[] = [];
  let y = Number(effectiveFrom.slice(0, 4));
  let m = Number(effectiveFrom.slice(5, 7));
  const end = todayIso.slice(0, 7);
  for (let i = 0; i < 600; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym >= end) break;
    out.push(ym);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
