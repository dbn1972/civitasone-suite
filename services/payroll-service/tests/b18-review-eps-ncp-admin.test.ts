/**
 * PR #2458 review should-fix (ERP-head decisions 2026-11-05) -- pure rules.
 *   SF1 EPS eligibility (EPS 1995 para 6A, GSR 609(E) 22.08.2014): post-2014
 *       joiner above Rs 15,000 / joint-option member / aged 58+ -> EPS 0 and all
 *       12% employer to A/c 1; pre-2014 member -> EPS capped at Rs 1,250.
 *       Golden ECR lines for each.
 *   SF2 NCP days exclude the days before joining / after leaving.
 *   SF3 A/c 2 minimum top-up = max(0, minimum - admin accrued), one per month.
 *   SF6 NONE scheme: no pension deduction.
 * Expected figures worked by hand from the statutory rates.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeSlip, epsEligibility, EPS_CUTOFF_DATE } from "../src/modules/payroll/domain.js";
import { buildEcrFile, ncpDaysFromComponents } from "../src/modules/statutory/ecr-domain.js";
import { adminTopUpMinor, adminTopUpJournal } from "../src/modules/statutory/admin-topup.js";

const GOLDEN = readFileSync(new URL("./fixtures/ecr-2.0-eps-golden.txt", import.meta.url), "utf8");
// The UAT contract staff: Basic Rs 18,000, DA 58% -> Basic + DA Rs 28,440.
const slip = (epsEligible?: boolean) => computeSlip({ basicMinor: 1_800_000n, daRateBps: 5800n, cityClass: "X", pensionScheme: "EPF", fyStartYear: 2026, ...(epsEligible === undefined ? {} : { epsEligible }) });

describe("SF1 + delta blocker: EPS eligibility from recorded facts only", () => {
  const yes = { eligible: true, recorded: true };
  const no = { eligible: false, recorded: true };
  it("nothing recorded (post-2014 joiner) -> treated as an EPS member, flagged unrecorded -- the current wage is never used", () => {
    expect(EPS_CUTOFF_DATE).toBe("2014-09-01");
    expect(epsEligibility({}, "2026-10-28")).toEqual({ eligible: true, recorded: false });
  });
  it("joining wage recorded: eligible iff <= Rs 15,000 at joining, and stays so whatever the pay later becomes", () => {
    expect(epsEligibility({ joiningWageMinor: "1500000" }, "2018-04-01")).toEqual(yes);
    expect(epsEligibility({ joiningWageMinor: "1200000" }, "2018-04-01")).toEqual(yes); // pay crossed Rs 15,000 since: still a member
    expect(epsEligibility({ joiningWageMinor: "2844000" }, "2018-04-01")).toEqual(no);
  });
  it("first EPF membership before 01.09.2014 (recorded via the UAN, or this joining date) -> eligible", () => {
    expect(epsEligibility({ firstJoinedOn: "2014-08-31", joiningWageMinor: 9_000_000 }, "2026-10-28")).toEqual(yes);
    expect(epsEligibility({}, "2010-06-01")).toEqual(yes);
  });
  it("para 26(6) joint-option member (the 6 UAT contract staff) -> not eligible, whatever the dates", () => {
    expect(epsEligibility({ voluntaryJointOption: true }, "2026-10-28")).toEqual(no);
    expect(epsEligibility({ voluntaryJointOption: true, firstJoinedOn: "2010-01-01" }, "2026-10-28")).toEqual(no);
  });
  it("EPS stops at 58: HRMS sends the per-month cutoff boolean, which wins over everything", () => {
    expect(epsEligibility({ firstJoinedOn: "2000-01-01", ageCutoffReached: false }, "2000-01-01")).toEqual(yes);
    expect(epsEligibility({ firstJoinedOn: "2000-01-01", ageCutoffReached: true }, "2000-01-01")).toEqual(no);
    expect(epsEligibility({ epsMember: true, ageCutoffReached: true }, "2000-01-01")).toEqual(no);
  });
  it("an explicit EPS membership recorded by HR wins over the derivation", () => {
    expect(epsEligibility({ epsMember: true, joiningWageMinor: "2844000" }, "2026-10-28")).toEqual(yes);
    expect(epsEligibility({ epsMember: false }, "2000-01-01")).toEqual(no);
  });

  it("not eligible: EPS 0, the whole employer 12% (Rs 1,800) goes to EPF (A/c 1); employee share unchanged", () => {
    const s = slip(false);
    expect(s.pfEmployeeMinor).toBe(180_000n);
    expect(s.pfEmployerMinor).toBe(180_000n);
    expect(s.epsMinor).toBe(0n);
    expect(s.epfEmployerMinor).toBe(180_000n);
  });
  it("eligible (and the default when omitted): EPS 8.33% of Rs 15,000 capped at Rs 1,250, EPF diff Rs 550", () => {
    for (const s of [slip(true), slip()]) {
      expect(s.epsMinor).toBe(125_000n);
      expect(s.epfEmployerMinor).toBe(55_000n);
    }
    expect(slip(false).netPayMinor).toBe(slip(true).netPayMinor); // employer split only
  });

  it("golden ECR lines: post-2014 above ceiling and aged 58+ -> EPS wages 0, EPS 0, diff 1,800; pre-2014 -> 15,000 / 1,250 / 550", () => {
    const line = (uan: string, name: string, eligible: boolean) => {
      const s = slip(eligible);
      return { uan, memberName: name, grossWages: Number(s.grossMinor / 100n), epfWages: 15000, epsWages: eligible ? 15000 : 0, edliWages: 15000,
        epfContributionEe: Number(s.pfEmployeeMinor / 100n), epsContributionEr: Number(s.epsMinor / 100n), epfEpsDiffEr: Number(s.epfEmployerMinor / 100n), ncpDays: 0, refundOfAdvances: 0 };
    };
    expect(buildEcrFile([
      line("100200300410", "Post 2014 Above Ceiling", epsEligibility({ joiningWageMinor: "2844000" }, "2026-10-28").eligible),
      line("100200300411", "Aged Fifty Eight", epsEligibility({ firstJoinedOn: "2000-01-01", ageCutoffReached: true }, "2000-01-01").eligible),
      line("100200300412", "Pre 2014 Member", epsEligibility({ firstJoinedOn: "2013-04-01" }, "2026-10-28").eligible),
    ])).toBe(GOLDEN);
  });
});

describe("SF2: NCP days", () => {
  it("a joiner on the 28th of a 28-day month (27 days not in service, no absence) -> NCP 0", () => {
    expect(ncpDaysFromComponents([{ code: "LOP", lopDays: 27, notInServiceDays: 27 }])).toBe(0);
  });
  it("only the attendance / leave LOP counts: 27 out of service + 2 absent -> NCP 2; half days round half up", () => {
    expect(ncpDaysFromComponents([{ code: "LOP", lopDays: 29, notInServiceDays: 27 }])).toBe(2);
    expect(ncpDaysFromComponents([{ code: "LOP", lopDays: 2.5 }])).toBe(3);
    expect(ncpDaysFromComponents([{ code: "LOP", lopDays: 3 }])).toBe(3); // rows written before SF2 (no notInServiceDays)
  });
});

describe("SF3: A/c 2 minimum top-up", () => {
  it("max(0, Rs 500 - admin accrued) for a month with members; nothing above the minimum or without members", () => {
    expect(adminTopUpMinor(45_000n, 6, 50_000n)).toBe(5_000n);   // 6 x Rs 75 = Rs 450 -> Rs 50
    expect(adminTopUpMinor(150_000n, 20, 50_000n)).toBe(0n);
    expect(adminTopUpMinor(0n, 0, 50_000n)).toBe(0n);
  });
  it("a negative delta (a later run reduced the shortfall) is the reversing pair", () => {
    const j = adminTopUpJournal({ journalId: "j2", tenantId: "t1", period: "2027-02", topUpMinor: -7_500n, postingDate: "2027-03-20" });
    expect(j.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["2103", "7500", "0"], ["5002", "0", "7500"]]);
  });
  it("the journal is one balanced Dr 5002 / Cr 2103 pair for the month", () => {
    const j = adminTopUpJournal({ journalId: "j1", tenantId: "t1", period: "2027-02", topUpMinor: 5_000n, postingDate: "2027-03-15" });
    expect(j).toMatchObject({ id: "j1", voucherNo: "PAY/EPF-A2/2027-02", type: "payroll_accrual" });
    expect(j.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["5002", "5000", "0"], ["2103", "0", "5000"]]);
  });
});

describe("SF6: no pension scheme", () => {
  it("NONE -> no PF, EPS, NPS or GPF, whatever the engagement gates say", () => {
    const s = computeSlip({ basicMinor: 1_800_000n, daRateBps: 5800n, cityClass: "X", pensionScheme: "NONE", fyStartYear: 2026 });
    expect([s.pfEmployeeMinor, s.pfEmployerMinor, s.epsMinor, s.npsEmployeeMinor, s.npsEmployerMinor, s.gpfMinor]).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
  });
});
