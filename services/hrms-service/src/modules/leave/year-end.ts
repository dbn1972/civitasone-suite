/**
 * UAT T-PERIOD D-14 (ERP-head decision 2026-11-05): leave year-end and the
 * half-yearly advance credit, per the CCS (Leave) Rules 1972. Pure.
 *
 * Leave year: the calendar year by default (CCS); a tenant may keep a
 * financial-year leave year (leave.hrms_leave_year_config.year_start_month = 4).
 * The two half-years start on month S and S + 6 (1 Jan / 1 Jul by default).
 *
 * Earned Leave (Rule 26 / 27, non-vacation staff):
 *  - 15 days credited IN ADVANCE on the first day of each half-year;
 *  - in the half-year of appointment: 2.5 days per completed calendar month of
 *    service in that half-year (Rule 27(1)(b));
 *  - reduced by 1/10th of the extraordinary leave (EOL) availed in the
 *    PREVIOUS half-year, at most 15 days (Rule 27(2));
 *  - fractions rounded to the nearest day (Rule 27(3));
 *  - the balance carried forward plus the credit may exceed 300 only inside
 *    the half-year: the advance credit is set off against leave taken in that
 *    half-year, and what still exceeds 300 at the next credit is LAPSED
 *    (recorded, with the days, as a cap_lapse entry and an audit event).
 * Half Pay Leave (Rule 29), when the tenant has an HPL type: 10 days on the
 *  same dates; 5/3 day per completed month in the half-year of appointment;
 *  reduced by 1/18th of the EOL of the previous half-year; no ceiling.
 * Casual Leave (not a CCS (Leave) Rules leave; GoI instructions): the balance
 *  lapses at the end of the leave year (no carry-forward), and the new year
 *  entitlement (the type maximum, default 8) is credited on its first day.
 * Encashment (LTC / on retirement) is out of scope of this job.
 *
 * Allocations are keyed by a leave-year label in hrms_leave_allocs.fy
 * (char 7): "YYYY-YY" for a financial leave year (as before), "YYYY-CY" for a
 * calendar one.
 */

export type LeaveYearStartMonth = 1 | 4;
export const EL_HALF_YEAR_CREDIT = 15;
export const EL_PER_COMPLETED_MONTH = 2.5;
export const EL_MAX_ACCUMULATION = 300;
export const HPL_HALF_YEAR_CREDIT = 10;
export const HPL_PER_COMPLETED_MONTH = 5 / 3;
export const DEFAULT_CL_PER_YEAR = 8;

/** Employee statuses that earn leave (in service). */
export const IN_SERVICE_STATUSES: ReadonlySet<string> = new Set(["probation", "confirmed", "on_leave", "suspended", "deputation"]);
/** Engagement types that earn EL / HPL under the CCS (Leave) Rules (contract staff: CL only). */
export const CCS_LEAVE_TYPES: ReadonlySet<string> = new Set(["permanent", "temporary", "deputation"]);

const pad2 = (n: number): string => String(n).padStart(2, "0");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return [y, m, d];
}
function iso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}
function lastDayOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function normaliseStartMonth(v: number | null | undefined): LeaveYearStartMonth | null {
  if (v == null) return 1;
  return v === 1 || v === 4 ? v : null;
}

/** The label of the leave year that starts on `start` (YYYY-MM-01). */
export function leaveYearLabel(startYear: number, startMonth: LeaveYearStartMonth): string {
  return startMonth === 1 ? `${startYear}-CY` : `${startYear}-${pad2((startYear + 1) % 100)}`;
}

/** First day of the leave year a label names, or null for an unknown label. */
export function leaveYearStartOfLabel(label: string): string | null {
  const t = label.trim();
  const cy = /^(\d{4})-CY$/.exec(t);
  if (cy) return `${cy[1]}-01-01`;
  const fy = /^(\d{4})-(\d{2})$/.exec(t);
  if (fy && Number(fy[2]) === (Number(fy[1]) + 1) % 100) return `${fy[1]}-04-01`;
  return null;
}

export interface HalfYear {
  /** First day of the half-year (the credit date), YYYY-MM-DD. */
  start: string;
  /** Last day of the half-year. */
  end: string;
  /** The previous half-year (for the EOL reduction). */
  prevStart: string;
  prevEnd: string;
  /** True when this half-year opens a new leave year (CL lapse / new allocation row). */
  opensLeaveYear: boolean;
  leaveYearStart: string;
  leaveYearLabel: string;
}

/** The half-year containing `date`. */
export function halfYearOf(date: string, startMonth: LeaveYearStartMonth): HalfYear {
  const [y, m] = ymd(date);
  const idx = y * 12 + (m - 1);
  const s0 = startMonth - 1;
  const offset = (((idx - s0) % 6) + 6) % 6;
  const startIdx = idx - offset;
  const sy = Math.floor(startIdx / 12), sm = (startIdx % 12) + 1;
  const endIdx = startIdx + 5;
  const ey = Math.floor(endIdx / 12), em = (endIdx % 12) + 1;
  const pIdx = startIdx - 6;
  const py = Math.floor(pIdx / 12), pm = (pIdx % 12) + 1;
  const pEndIdx = startIdx - 1;
  const pey = Math.floor(pEndIdx / 12), pem = (pEndIdx % 12) + 1;
  // Both half-years of a leave year start in the same calendar year (S and
  // S + 6 with S = 1 or 4), so the leave year starts in month S of `sy`.
  return {
    start: iso(sy, sm, 1), end: iso(ey, em, lastDayOf(ey, em)),
    prevStart: iso(py, pm, 1), prevEnd: iso(pey, pem, lastDayOf(pey, pem)),
    opensLeaveYear: sm === startMonth,
    leaveYearStart: iso(sy, startMonth, 1),
    leaveYearLabel: leaveYearLabel(sy, startMonth),
  };
}

/** True when `date` is a half-year credit date (1 Jan / 1 Jul, or 1 Apr / 1 Oct). */
export function isCreditDate(date: string, startMonth: LeaveYearStartMonth): boolean {
  return ISO.test(date) && halfYearOf(date, startMonth).start === date;
}

/** Completed calendar months of service from `from` (DOJ) to `to` (inclusive). */
export function completedCalendarMonths(from: string, to: string): number {
  const [fy, fm, fd] = ymd(from);
  const [ty, tm, td] = ymd(to);
  const startIdx = fy * 12 + (fm - 1) + (fd === 1 ? 0 : 1);
  const endIdx = ty * 12 + (tm - 1) - (td === lastDayOf(ty, tm) ? 0 : 1);
  return endIdx < startIdx ? 0 : endIdx - startIdx + 1;
}

/** Rule 27(3): a fraction of a day is rounded off to the nearest day (half up). */
export function roundToNearestDay(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

export interface HalfYearCredit { days: number; basis: "full" | "pro_rata" | "none"; eolReductionDays: number; completedMonths?: number }

/** The advance credit of one half-year for EL or HPL. */
export function halfYearCredit(kind: "EL" | "HPL", half: Pick<HalfYear, "start" | "end">, dateOfJoining: string | null, eolDaysPrevHalf: number): HalfYearCredit {
  const full = kind === "EL" ? EL_HALF_YEAR_CREDIT : HPL_HALF_YEAR_CREDIT;
  if (dateOfJoining && dateOfJoining.slice(0, 10) > half.end) return { days: 0, basis: "none", eolReductionDays: 0 };
  let base = full;
  let basis: HalfYearCredit["basis"] = "full";
  let completedMonths: number | undefined;
  if (dateOfJoining && dateOfJoining.slice(0, 10) > half.start) {
    completedMonths = completedCalendarMonths(dateOfJoining.slice(0, 10), half.end);
    base = Math.min(full, roundToNearestDay(completedMonths * (kind === "EL" ? EL_PER_COMPLETED_MONTH : HPL_PER_COMPLETED_MONTH)));
    basis = "pro_rata";
  }
  const eol = Math.max(0, eolDaysPrevHalf);
  const eolReductionDays = Math.min(full, roundToNearestDay(eol / (kind === "EL" ? 10 : 18)));
  return { days: Math.max(0, base - eolReductionDays), basis, eolReductionDays, ...(completedMonths != null ? { completedMonths } : {}) };
}

export interface YearEndAlloc { id: string; leaveTypeId: string; label: string; totalDays: number; balanceDays: number }
export interface YearEndLeaveType { id: string; code: string; maxDays: number }
export interface YearEndEmployee { id: string; employeeNo: string; dateOfJoining: string | null; employeeType: string; status: string }

export type YearEndAction = "carry_forward" | "cap_lapse" | "credit" | "lapse";
export interface YearEndEntry { action: YearEndAction; days: number; allocId: string | null; note?: string }

/** One allocation change for one employee and leave type. */
export interface YearEndOp {
  employeeId: string; employeeNo: string; leaveTypeId: string; code: "EL" | "HPL" | "CL";
  /** Target allocation: an existing row (update) or a new one (create, allocId null). */
  targetAllocId: string | null; targetLabel: string;
  newTotalDays: number; newBalanceDays: number;
  /** A previous leave-year row whose balance is moved (carry-forward) or lapsed; its balance becomes 0. */
  sourceAllocId: string | null; sourceBalanceDays: number;
  entries: YearEndEntry[];
  credit?: HalfYearCredit;
  warnings: string[];
}

function latestPriorRow(allocs: YearEndAlloc[], leaveTypeId: string, before: string): YearEndAlloc | null {
  let best: YearEndAlloc | null = null;
  let bestStart = "";
  for (const a of allocs) {
    if (a.leaveTypeId !== leaveTypeId) continue;
    const s = leaveYearStartOfLabel(a.label);
    if (!s || s >= before) continue;
    if (s > bestStart) { best = a; bestStart = s; }
  }
  return best;
}

/**
 * The year-end / half-year operations for ONE employee on the credit date
 * `half.start`. `done`: leave type ids already processed for this credit date
 * (idempotency; their ops are not produced again).
 */
export function planEmployeeYearEnd(input: {
  half: HalfYear; employee: YearEndEmployee;
  types: { EL?: YearEndLeaveType; HPL?: YearEndLeaveType; CL?: YearEndLeaveType };
  allocs: YearEndAlloc[]; eolDaysPrevHalf: number; done?: ReadonlySet<string>;
}): YearEndOp[] {
  const { half, employee, types, allocs } = input;
  const done = input.done ?? new Set<string>();
  const ops: YearEndOp[] = [];
  if (!IN_SERVICE_STATUSES.has(employee.status)) return ops;
  if (employee.dateOfJoining && employee.dateOfJoining.slice(0, 10) > half.end) return ops;
  const ccs = CCS_LEAVE_TYPES.has(employee.employeeType);
  const label = half.leaveYearLabel;

  const credited = (code: "EL" | "HPL", t: YearEndLeaveType, cap: number | null): void => {
    if (done.has(t.id)) return;
    const credit = halfYearCredit(code, half, employee.dateOfJoining, input.eolDaysPrevHalf);
    const target = allocs.find((a) => a.leaveTypeId === t.id && a.label.trim() === label) ?? null;
    const entries: YearEndEntry[] = [];
    const warnings: string[] = [];
    let opening: number;
    let baseTotal: number;
    let source: YearEndAlloc | null = null;
    if (target) {
      opening = target.balanceDays;
      baseTotal = target.totalDays;
      if (half.opensLeaveYear) {
        const prior = latestPriorRow(allocs, t.id, half.leaveYearStart);
        if (prior && prior.balanceDays > 0) warnings.push(`an allocation for ${label} already exists; the ${prior.label.trim()} balance of ${prior.balanceDays} day(s) was not carried forward again -- check it`);
      }
    } else if (half.opensLeaveYear) {
      source = latestPriorRow(allocs, t.id, half.leaveYearStart);
      opening = source ? Math.max(0, source.balanceDays) : 0;
      baseTotal = 0;
    } else {
      // Mid-year credit but no row for this leave year (it was never opened): start one.
      source = latestPriorRow(allocs, t.id, half.leaveYearStart);
      opening = source ? Math.max(0, source.balanceDays) : 0;
      baseTotal = 0;
      if (source) warnings.push(`no ${label} allocation existed at the mid-year credit; the ${source.label.trim()} balance is carried into a new one`);
    }
    const capped = cap != null && opening > cap ? cap : opening;
    const capLapse = opening - capped;
    if (source && capped > 0) entries.push({ action: "carry_forward", days: capped, allocId: source.id });
    if (capLapse > 0) entries.push({ action: "cap_lapse", days: capLapse, allocId: source?.id ?? target?.id ?? null, note: `balance above the ${cap}-day ceiling lapses (CCS (Leave) Rules, Rule 26)` });
    if (credit.days > 0) entries.push({ action: "credit", days: credit.days, allocId: target?.id ?? null });
    if (entries.length === 0) return;
    const newBalance = capped + credit.days;
    const newTotal = target ? Math.max(newBalance, baseTotal - capLapse + credit.days) : newBalance;
    ops.push({
      employeeId: employee.id, employeeNo: employee.employeeNo, leaveTypeId: t.id, code,
      targetAllocId: target?.id ?? null, targetLabel: label, newTotalDays: newTotal, newBalanceDays: newBalance,
      sourceAllocId: source?.id ?? null, sourceBalanceDays: source ? source.balanceDays : 0,
      entries, credit, warnings,
    });
  };

  if (ccs && types.EL) credited("EL", types.EL, EL_MAX_ACCUMULATION);
  if (ccs && types.HPL) credited("HPL", types.HPL, null);

  // CL: lapses at the end of the leave year; the new year entitlement on its first day.
  if (types.CL && half.opensLeaveYear && !done.has(types.CL.id)) {
    const t = types.CL;
    const target = allocs.find((a) => a.leaveTypeId === t.id && a.label.trim() === label) ?? null;
    const source = latestPriorRow(allocs, t.id, half.leaveYearStart);
    const entries: YearEndEntry[] = [];
    const warnings: string[] = [];
    if (source && source.balanceDays > 0) entries.push({ action: "lapse", days: source.balanceDays, allocId: source.id, note: "casual leave lapses at the end of the leave year (no carry-forward)" });
    const entitlement = t.maxDays > 0 ? t.maxDays : DEFAULT_CL_PER_YEAR;
    if (!target) entries.push({ action: "credit", days: entitlement, allocId: null });
    else warnings.push(`a ${label} casual leave allocation already exists; not credited again`);
    if (entries.length > 0) {
      ops.push({
        employeeId: employee.id, employeeNo: employee.employeeNo, leaveTypeId: t.id, code: "CL",
        targetAllocId: target?.id ?? null, targetLabel: label,
        newTotalDays: target ? target.totalDays : entitlement, newBalanceDays: target ? target.balanceDays : entitlement,
        sourceAllocId: source && source.balanceDays > 0 ? source.id : null, sourceBalanceDays: source ? source.balanceDays : 0,
        entries, warnings,
      });
    }
  }
  return ops;
}

/** EOL days (calendar) of approved EOL applications falling inside [from, to]. */
export function eolDaysWithin(apps: Array<{ fromDate: string; toDate: string }>, from: string, to: string): number {
  let days = 0;
  for (const a of apps) {
    const s = a.fromDate.slice(0, 10) > from ? a.fromDate.slice(0, 10) : from;
    const e = a.toDate.slice(0, 10) < to ? a.toDate.slice(0, 10) : to;
    if (e < s) continue;
    days += Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86_400_000) + 1;
  }
  return days;
}
