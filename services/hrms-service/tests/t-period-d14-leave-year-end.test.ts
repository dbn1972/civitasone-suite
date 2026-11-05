/**
 * UAT T-PERIOD D-14 (ERP-head decision 2026-11-05): CCS (Leave) Rules 1972
 * leave year-end -- pure rules (modules/leave/year-end.ts).
 *  - calendar leave year by default: half-years from 1 Jan / 1 Jul; a
 *    financial leave year (start month 4) from 1 Apr / 1 Oct;
 *  - EL 15 days in advance per half-year; 2.5 days per completed calendar
 *    month in the half-year of appointment; less 1/10th of the previous
 *    half-year EOL (max 15); nearest day;
 *  - EL ceiling 300: what exceeds it at the next credit lapses (recorded);
 *  - HPL 10 days per half-year (5/3 per month for joiners, less 1/18th of EOL);
 *  - CL lapses at the end of the leave year, the new entitlement on its first day.
 */
import { describe, it, expect } from "vitest";
import {
  halfYearOf, isCreditDate, completedCalendarMonths, halfYearCredit, planEmployeeYearEnd, eolDaysWithin,
  leaveYearLabel, leaveYearStartOfLabel, normaliseStartMonth, superannuationDate, diesNonDaysWithin, exitDateOf, type YearEndAlloc,
} from "../src/modules/leave/year-end.js";

const EL = { id: "t-el", code: "EL", maxDays: 30 };
const CL = { id: "t-cl", code: "CL", maxDays: 8 };
const HPL = { id: "t-hpl", code: "HPL", maxDays: 20 };
const emp = (over: Partial<{ id: string; employeeNo: string; dateOfJoining: string | null; employeeType: string; status: string }> = {}) => ({
  id: "e1", employeeNo: "TP-EMP-01", dateOfJoining: "2020-04-01", employeeType: "permanent", status: "probation", ...over,
});
const alloc = (id: string, leaveTypeId: string, label: string, total: number, balance: number): YearEndAlloc => ({ id, leaveTypeId, label, totalDays: total, balanceDays: balance });

describe("leave year and half-years", () => {
  it("calendar year (default): 1 Jan opens the leave year, 1 Jul is the second half", () => {
    expect(normaliseStartMonth(null)).toBe(1);
    expect(normaliseStartMonth(7)).toBeNull();
    expect(halfYearOf("2027-01-01", 1)).toEqual({ start: "2027-01-01", end: "2027-06-30", prevStart: "2026-07-01", prevEnd: "2026-12-31", opensLeaveYear: true, leaveYearStart: "2027-01-01", leaveYearLabel: "2027-CY" });
    expect(halfYearOf("2027-09-15", 1)).toMatchObject({ start: "2027-07-01", end: "2027-12-31", opensLeaveYear: false, leaveYearLabel: "2027-CY" });
    expect(isCreditDate("2027-01-01", 1)).toBe(true);
    expect(isCreditDate("2027-07-01", 1)).toBe(true);
    expect(isCreditDate("2027-04-01", 1)).toBe(false);
  });

  it("financial leave year (start month 4): 1 Apr / 1 Oct, labels YYYY-YY", () => {
    expect(halfYearOf("2027-04-01", 4)).toMatchObject({ start: "2027-04-01", end: "2027-09-30", opensLeaveYear: true, leaveYearLabel: "2027-28" });
    expect(halfYearOf("2028-01-15", 4)).toMatchObject({ start: "2027-10-01", end: "2028-03-31", prevStart: "2027-04-01", prevEnd: "2027-09-30", opensLeaveYear: false, leaveYearLabel: "2027-28" });
    expect(isCreditDate("2027-01-01", 4)).toBe(false);
  });

  it("labels round-trip; the existing FY labels are understood", () => {
    expect(leaveYearLabel(2027, 1)).toBe("2027-CY");
    expect(leaveYearLabel(2026, 4)).toBe("2026-27");
    expect(leaveYearStartOfLabel("2026-27")).toBe("2026-04-01");
    expect(leaveYearStartOfLabel("2027-CY")).toBe("2027-01-01");
    expect(leaveYearStartOfLabel("2026-99")).toBeNull();
  });
});

describe("half-year credit (CCS (Leave) Rules 27 and 29)", () => {
  const h1 = { start: "2027-01-01", end: "2027-06-30" };
  it("in service all half-year: EL 15, HPL 10", () => {
    expect(halfYearCredit("EL", h1, "2020-04-01", 0)).toEqual({ days: 15, basis: "full", eolReductionDays: 0 });
    expect(halfYearCredit("HPL", h1, "2020-04-01", 0).days).toBe(10);
  });
  it("joiner: 2.5 days per completed calendar month, nearest day", () => {
    expect(completedCalendarMonths("2027-02-15", "2027-06-30")).toBe(4);
    expect(completedCalendarMonths("2027-02-01", "2027-06-30")).toBe(5);
    expect(halfYearCredit("EL", h1, "2027-02-15", 0)).toMatchObject({ days: 10, basis: "pro_rata", completedMonths: 4 });
    expect(halfYearCredit("EL", h1, "2027-02-01", 0).days).toBe(13); // 12.5 -> 13
    expect(halfYearCredit("HPL", h1, "2027-04-01", 0).days).toBe(5); // 3 x 5/3
    expect(halfYearCredit("EL", h1, "2027-07-02", 0)).toMatchObject({ days: 0, basis: "none" });
  });
  it("EOL of the previous half-year: EL less 1/10th (max 15), HPL less 1/18th", () => {
    expect(halfYearCredit("EL", h1, "2020-04-01", 25)).toMatchObject({ days: 12, eolReductionDays: 3 }); // 2.5 -> 3
    expect(halfYearCredit("EL", h1, "2020-04-01", 200)).toMatchObject({ days: 0, eolReductionDays: 15 });
    expect(halfYearCredit("HPL", h1, "2020-04-01", 36)).toMatchObject({ days: 8, eolReductionDays: 2 });
    expect(eolDaysWithin([{ fromDate: "2026-12-20", toDate: "2027-01-10" }, { fromDate: "2026-08-01", toDate: "2026-08-05" }], "2026-07-01", "2026-12-31")).toBe(17);
  });
});

describe("PR #2459 review SF5: retirement half-year, dies non, later allocations", () => {
  const h1 = { start: "2027-01-01", end: "2027-06-30" };
  it("FR 56(a): superannuation at 60 on the last day of the birth month (born on the 1st: the previous month)", () => {
    expect(superannuationDate("1967-04-15")).toBe("2027-04-30");
    expect(superannuationDate("1967-04-01")).toBe("2027-03-31");
    expect(superannuationDate("1967-01-01")).toBe("2026-12-31");
    expect(superannuationDate(null)).toBeNull();
  });
  it("Rule 27(2)(a): the retirement half-year gets 2.5 days per completed month up to retirement, not 15 in advance", () => {
    expect(halfYearCredit("EL", h1, "2000-01-01", 0, "2027-04-30")).toMatchObject({ days: 10, basis: "pro_rata", completedMonths: 4 });
    expect(halfYearCredit("EL", h1, "2000-01-01", 0, "2026-12-31")).toMatchObject({ days: 0, basis: "none" });
    const ops = planEmployeeYearEnd({ half: halfYearOf("2027-01-01", 1), employee: { ...emp(), dateOfBirth: "1967-04-15", superannuationAge: 60 }, types: { EL }, allocs: [alloc("el", "t-el", "2026-27", 100, 100)], eolDaysPrevHalf: 0 });
    expect(ops[0]!.entries.find((e) => e.action === "credit")!.days).toBe(10);
    expect(ops[0]!.warnings.join(" ")).toMatch(/retires \(FR 56\) on 2027-04-30/);
    expect(planEmployeeYearEnd({ half: halfYearOf("2027-01-01", 1), employee: { ...emp(), dateOfBirth: "1966-11-20", superannuationAge: 60 }, types: { EL, CL }, allocs: [], eolDaysPrevHalf: 0 })).toEqual([]);
  });

  it("delta review SF4: the age comes from the employee type (62 here); contract staff are not superannuated; resignation is proportional too", () => {
    const half = halfYearOf("2027-01-01", 1);
    // at 62 the same DOB retires in 2029: full 15 in 2027
    const at62 = planEmployeeYearEnd({ half, employee: { ...emp(), dateOfBirth: "1967-04-15", superannuationAge: 62 }, types: { EL }, allocs: [], eolDaysPrevHalf: 0 });
    expect(at62[0]!.entries.find((e) => e.action === "credit")!.days).toBe(15);
    // a contract employee past 60 keeps getting CL
    const contract = planEmployeeYearEnd({ half, employee: { ...emp({ employeeType: "contract" }), dateOfBirth: "1960-01-15", superannuationAge: null }, types: { EL, CL }, allocs: [], eolDaysPrevHalf: 0 });
    expect(contract.map((o) => o.code)).toEqual(["CL"]);
    // resignation with last working day 31 Mar 2027: Jan..Mar = 3 months x 2.5 = 8 (7.5 rounded)
    const resigning = planEmployeeYearEnd({ half, employee: { ...emp(), separationDate: "2027-03-31" }, types: { EL }, allocs: [], eolDaysPrevHalf: 0 });
    expect(resigning[0]!.entries.find((e) => e.action === "credit")!.days).toBe(8);
    expect(resigning[0]!.warnings.join(" ")).toMatch(/leaves service \(separation\) on 2027-03-31/);
    expect(exitDateOf({ dateOfBirth: "1967-04-15", superannuationAge: 60, separationDate: "2027-02-28" })).toBe("2027-02-28");
  });
  it("Rule 27(3): dies non (service book) counts with EOL in the reduction", () => {
    const entries = [
      { entryType: "dies_non", effectiveDate: "2026-08-10", description: "unauthorised absence; days=12" },
      { entryType: "dies_non", effectiveDate: "2026-12-28", description: "strike from=2026-12-28;to=2027-01-05" },
      { entryType: "dies_non", effectiveDate: "2026-03-01", description: "days=30" },
      { entryType: "eol_without_qs", effectiveDate: "2026-09-01", description: "days=10" },
    ];
    expect(diesNonDaysWithin(entries, "2026-07-01", "2026-12-31")).toBe(16);
    expect(halfYearCredit("EL", h1, "2000-01-01", 16 + 9).eolReductionDays).toBe(3);
  });
  it("dry run warns about a later FY-labelled allocation that would double-allocate (T-PERIOD EL 2027-28)", () => {
    const ops = planEmployeeYearEnd({ half: halfYearOf("2027-01-01", 1), employee: emp(), types: { EL }, allocs: [alloc("el-fy", "t-el", "2026-27", 300, 290), alloc("el-next", "t-el", "2027-28", 300, 300)], eolDaysPrevHalf: 0 });
    expect(ops[0]!.warnings.join(" ")).toMatch(/later allocation 2027-28 \(300 day\(s\)\) exists beside 2027-CY; it would double-allocate/);
  });
});

describe("planEmployeeYearEnd", () => {
  const jan = halfYearOf("2027-01-01", 1);
  const jul = halfYearOf("2027-07-01", 1);

  it("T-PERIOD TP-EMP-01 on 1 Jan 2027: EL 290 carried + 15 credited into 2027-CY; CL 8 lapses, 8 credited", () => {
    const ops = planEmployeeYearEnd({ half: jan, employee: emp(), types: { EL, CL }, allocs: [alloc("el-fy", "t-el", "2026-27", 300, 290), alloc("cl-fy", "t-cl", "2026-27", 8, 8)], eolDaysPrevHalf: 0 });
    const el = ops.find((o) => o.code === "EL")!;
    expect(el).toMatchObject({ targetAllocId: null, targetLabel: "2027-CY", newTotalDays: 305, newBalanceDays: 305, sourceAllocId: "el-fy", sourceBalanceDays: 290 });
    expect(el.entries).toEqual([{ action: "carry_forward", days: 290, allocId: "el-fy" }, { action: "credit", days: 15, allocId: null }]);
    const cl = ops.find((o) => o.code === "CL")!;
    expect(cl).toMatchObject({ targetLabel: "2027-CY", newTotalDays: 8, newBalanceDays: 8, sourceAllocId: "cl-fy" });
    expect(cl.entries.map((e) => [e.action, e.days])).toEqual([["lapse", 8], ["credit", 8]]);
  });

  it("300-day ceiling: at the next credit the balance above 300 lapses (recorded), then 15 are credited", () => {
    // 1 Jan credit took 290 -> 305; no EL taken by 1 Jul: 5 days lapse, 300 + 15 = 315 for the half-year.
    const ops = planEmployeeYearEnd({ half: jul, employee: emp(), types: { EL }, allocs: [alloc("el-cy", "t-el", "2027-CY", 305, 305)], eolDaysPrevHalf: 0 });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ targetAllocId: "el-cy", newBalanceDays: 315, newTotalDays: 315, sourceAllocId: null });
    expect(ops[0]!.entries.map((e) => [e.action, e.days])).toEqual([["cap_lapse", 5], ["credit", 15]]);
    // EL taken in the half-year is set off against the advance credit first: 305 - 12 = 293 -> no lapse.
    const used = planEmployeeYearEnd({ half: jul, employee: emp(), types: { EL }, allocs: [alloc("el-cy", "t-el", "2027-CY", 305, 293)], eolDaysPrevHalf: 0 });
    expect(used[0]!.entries.map((e) => [e.action, e.days])).toEqual([["credit", 15]]);
    expect(used[0]!.newBalanceDays).toBe(308);
  });

  it("carry-forward above 300 at the rollover: 300 carried, the rest lapses", () => {
    const ops = planEmployeeYearEnd({ half: jan, employee: emp(), types: { EL }, allocs: [alloc("el-old", "t-el", "2026-CY", 315, 310)], eolDaysPrevHalf: 0 });
    expect(ops[0]!.entries.map((e) => [e.action, e.days])).toEqual([["carry_forward", 300], ["cap_lapse", 10], ["credit", 15]]);
    expect(ops[0]!.newBalanceDays).toBe(315);
  });

  it("HPL (when the tenant has the type): 10 days, no ceiling; contract staff get CL only", () => {
    const hpl = planEmployeeYearEnd({ half: jul, employee: emp(), types: { HPL }, allocs: [alloc("h", "t-hpl", "2027-CY", 400, 400)], eolDaysPrevHalf: 0 });
    expect(hpl[0]!.entries.map((e) => [e.action, e.days])).toEqual([["credit", 10]]);
    expect(hpl[0]!.newBalanceDays).toBe(410);
    const contract = planEmployeeYearEnd({ half: jan, employee: emp({ employeeType: "contract" }), types: { EL, CL, HPL }, allocs: [], eolDaysPrevHalf: 0 });
    expect(contract.map((o) => o.code)).toEqual(["CL"]);
  });

  it("not in service (separated / retired / not yet joined): nothing", () => {
    expect(planEmployeeYearEnd({ half: jan, employee: emp({ status: "separated" }), types: { EL, CL }, allocs: [], eolDaysPrevHalf: 0 })).toEqual([]);
    expect(planEmployeeYearEnd({ half: jan, employee: emp({ dateOfJoining: "2027-08-01" }), types: { EL, CL }, allocs: [], eolDaysPrevHalf: 0 })).toEqual([]);
  });

  it("idempotent: leave types already processed for the credit date are skipped", () => {
    const ops = planEmployeeYearEnd({ half: jan, employee: emp(), types: { EL, CL }, allocs: [alloc("el-fy", "t-el", "2026-27", 300, 290)], eolDaysPrevHalf: 0, done: new Set(["t-el", "t-cl"]) });
    expect(ops).toEqual([]);
  });

  it("a new-year row HR already typed in is not carried into twice (warning instead)", () => {
    const ops = planEmployeeYearEnd({ half: jan, employee: emp(), types: { EL }, allocs: [alloc("el-fy", "t-el", "2026-27", 300, 290), alloc("el-new", "t-el", "2027-CY", 300, 300)], eolDaysPrevHalf: 0 });
    expect(ops[0]).toMatchObject({ targetAllocId: "el-new", sourceAllocId: null, newBalanceDays: 315 });
    expect(ops[0]!.warnings[0]).toMatch(/not carried forward again/);
  });

  it("financial leave year tenant: 1 Apr opens 2027-28 from the 2026-27 row", () => {
    const apr = halfYearOf("2027-04-01", 4);
    const ops = planEmployeeYearEnd({ half: apr, employee: emp(), types: { EL, CL }, allocs: [alloc("el-fy", "t-el", "2026-27", 300, 120), alloc("cl-fy", "t-cl", "2026-27", 8, 3)], eolDaysPrevHalf: 0 });
    expect(ops.map((o) => [o.code, o.targetLabel, o.newBalanceDays])).toEqual([["EL", "2027-28", 135], ["CL", "2027-28", 8]]);
  });
});
