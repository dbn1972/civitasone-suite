/**
 * UAT b18 D1 / D3 (EPF for contract staff, 2026-11-05): pension scheme rules.
 * Pure -- no I/O. Used by employee create, the maker-checker change routes
 * (pension-scheme-routes.ts), the worker tick and the payroll-input feed.
 */

/** Schemes a change can move an employee TO (and that payroll computes). */
export const PENSION_SCHEMES = ["GPF", "NPS", "EPF", "UPS"] as const;
/** Recorded at hire / by an override, never offered as an ordinary change: no pension scheme. */
export const NO_SCHEME = "NONE";
export type PensionScheme = (typeof PENSION_SCHEMES)[number] | typeof NO_SCHEME;

/**
 * Review SF6 (ERP-head decision 2026-11-05): engagement types on NO pension
 * scheme and with no pension deduction -- apprentices (Apprentices Act stipend)
 * and consultants (invoice-billed). Matched case-insensitively.
 */
export const NO_SCHEME_ENGAGEMENT_TYPES: ReadonlySet<string> = new Set(["apprentice", "consultant"]);

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
 *   - apprentice / consultant                     -> NONE (no pension scheme)
 *   - contract / contractual / PSU employee types  -> EPF (any joining date;
 *     GPF and NPS are government-servant schemes, contract and PSU staff are
 *     never on them)
 *   - otherwise joined before 2004-01-01            -> GPF
 *   - otherwise                                     -> NPS (UPS can be chosen
 *     explicitly at hire or later through a scheme change)
 */
export function defaultPensionScheme(input: { dateOfJoining: string; employeeType?: string | null }): PensionScheme {
  const type = (input.employeeType ?? "").trim().toLowerCase();
  if (NO_SCHEME_ENGAGEMENT_TYPES.has(type)) return NO_SCHEME;
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

/**
 * Delta review SF1 (PII): EPS stops at 58. payroll-input sends only this
 * per-month boolean -- whether the member was 58 or older before `month`
 * (YYYY-MM) began -- never the DOB or a date derived from it. null without a DOB.
 */
export function epsAgeCutoffReached(dateOfBirth: string | null | undefined, month: string): boolean | null {
  const at58 = attains58On(dateOfBirth);
  return at58 == null ? null : at58 < `${month}-01`;
}

/** The day a member born on `dateOfBirth` attains 58 (EPS contributions stop, para 6A). null without a DOB. Internal: never sent. */
export function attains58On(dateOfBirth: string | null | undefined): string | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  return `${Number(dateOfBirth.slice(0, 4)) + 58}${dateOfBirth.slice(4)}`;
}

export type SchemeChangeVerdict = { ok: true } | { ok: false; code: "PENSION_SCHEME_NOT_ALLOWED"; reason: string };

/**
 * Review SF5 (ERP-head decision 2026-11-05): the scheme changes allowed
 * without an override.
 *   - contract / contractual / PSU  -> EPF only
 *   - apprentice / consultant       -> NONE only (existing staff can be moved there)
 *   - regular, joined before 2004   -> GPF only
 *   - regular, joined 2004 or later -> NPS <-> UPS: UPS only from NPS and only
 *     once; the one-time switch back UPS -> NPS also only once (UPS rules,
 *     notification of 24 Jan 2025)
 * `history`: the approved changes so far (to tell "once" apart). Anything else
 * needs an explicit override reason recorded by a super_admin. Pure.
 */
export function schemeChangeVerdict(input: {
  employeeType?: string | null; dateOfJoining: string; fromScheme: string; toScheme: string;
  history: ReadonlyArray<{ fromScheme: string; toScheme: string }>;
}): SchemeChangeVerdict {
  const type = (input.employeeType ?? "").trim().toLowerCase();
  const no = (reason: string): SchemeChangeVerdict => ({ ok: false, code: "PENSION_SCHEME_NOT_ALLOWED", reason });
  // Delta review SF3: apprentices / consultants move to NONE (no override).
  if (NO_SCHEME_ENGAGEMENT_TYPES.has(type)) return input.toScheme === NO_SCHEME ? { ok: true } : no(`a ${type} is on no pension scheme`);
  if (input.toScheme === NO_SCHEME) return no("only apprentices and consultants are on no pension scheme");
  if (EPF_ENGAGEMENT_TYPES.has(type)) return input.toScheme === "EPF" ? { ok: true } : no("contract and PSU staff are EPF members only");
  if (input.dateOfJoining < NPS_START_DATE) return input.toScheme === "GPF" ? { ok: true } : no("a regular employee who joined before 2004-01-01 is on GPF");
  if (input.toScheme === "UPS") {
    if (input.fromScheme !== "NPS") return no("UPS can be chosen only from NPS");
    if (input.history.some((h) => h.toScheme === "UPS")) return no("the UPS option has already been exercised once");
    return { ok: true };
  }
  if (input.toScheme === "NPS") {
    if (input.fromScheme !== "UPS") return no("a regular employee who joined in 2004 or later moves to NPS only back from UPS");
    if (input.history.some((h) => h.fromScheme === "UPS" && h.toScheme === "NPS")) return no("the one-time switch back from UPS to NPS has already been used");
    return { ok: true };
  }
  return no(`a regular employee who joined in 2004 or later is on NPS or UPS, not ${input.toScheme}`);
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
