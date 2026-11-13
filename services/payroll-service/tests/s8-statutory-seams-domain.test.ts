/**
 * S8 statutory seams -- hand-computed goldens (amounts in paise, default statutory config:
 * PF 12% on a Rs 15,000 ceiling, EPS 8.33% capped Rs 1,250, ESI 0.75% / 3.25% at a Rs 21,000 ceiling).
 * The flag-off byte-identity proof is s8-computeslip-pin.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { computeSlip, epfEmployerCharges, DEFAULT_STATUTORY_CONFIG, type SlipInput } from "../src/modules/payroll/domain.js";
import {
  pfWageBasisFor, lwfDueForMonth, esiContributionPeriodStart, esiContinuesInPeriod,
} from "../src/modules/payroll/statutory-seams.js";

const R = (n: number) => BigInt(n) * 100n;
const consolidatedEpf = (o: Partial<SlipInput>): SlipInput => ({
  basicMinor: R(40_000), payProfile: { kind: "consolidated_contract" }, pensionScheme: "EPF", statutoryEsi: false, ...o,
});
const line = (r: ReturnType<typeof computeSlip>, code: string) => r.deductions.find((d) => d.code === code)?.amountMinor;

describe("SEAM 1: PF wage basis per employee", () => {
  it("default (omitted) and explicit ceiling: 12% of the Rs 15,000 ceiling = 1,800; EPS 1,250; EPF 550", () => {
    for (const input of [consolidatedEpf({}), consolidatedEpf({ pfWageBasis: "ceiling" })]) {
      const r = computeSlip(input);
      expect(r.pfEmployeeMinor).toBe(R(1_800));
      expect(r.pfEmployerMinor).toBe(R(1_800));
      expect(r.epsMinor).toBe(R(1_250));
      expect(r.epfEmployerMinor).toBe(R(550));
    }
  });
  it("actual: 12% of Rs 40,000 = 4,800 both sides; EPS stays at the ceiling (1,250); EPF balance 3,550", () => {
    const r = computeSlip(consolidatedEpf({ pfWageBasis: "actual" }));
    expect(r.pfEmployeeMinor).toBe(R(4_800));
    expect(r.pfEmployerMinor).toBe(R(4_800));
    expect(r.epsMinor).toBe(R(1_250));
    expect(r.epfEmployerMinor).toBe(R(3_550));
    expect(r.totalDeductionsMinor).toBe(R(4_800) + r.tdsMinor);
  });
  it("actual at or under the ceiling changes nothing", () => {
    const low = { basicMinor: R(12_000) } as const;
    expect(computeSlip(consolidatedEpf({ ...low, pfWageBasis: "actual" }))).toEqual(computeSlip(consolidatedEpf({ ...low })));
  });
  it("actual does not touch an NPS / GPF member", () => {
    const nps = { pensionScheme: "NPS", payProfile: undefined, basicMinor: R(40_000) } as const;
    expect(computeSlip({ ...nps, pfWageBasis: "actual" } as SlipInput)).toEqual(computeSlip({ ...nps } as SlipInput));
  });
  it("EPS ineligible member on actual: whole 12% to EPF", () => {
    const r = computeSlip(consolidatedEpf({ pfWageBasis: "actual", epsEligible: false }));
    expect(r.epsMinor).toBe(0n);
    expect(r.epfEmployerMinor).toBe(R(4_800));
  });
  it("epfEmployerCharges: actual -> EPF wage and A/c 2 admin on Rs 40,000 (200); EDLI wage stays capped (75)", () => {
    const c = epfEmployerCharges(R(40_000), DEFAULT_STATUTORY_CONFIG, "actual");
    expect(c.pfWageMinor).toBe(R(40_000));
    expect(c.epfAdminMinor).toBe(R(200));
    expect(c.edliWageMinor).toBe(R(15_000));
    expect(c.edliMinor).toBe(R(75));
    expect(epfEmployerCharges(R(40_000), DEFAULT_STATUTORY_CONFIG)).toEqual(epfEmployerCharges(R(40_000), DEFAULT_STATUTORY_CONFIG, "ceiling"));
  });
  it("pfWageBasisFor: effective-dated, default ceiling, latest row at or before the month wins", () => {
    const rows = [{ effectiveFrom: "2026-12-01", basis: "actual" as const }, { effectiveFrom: "2027-04-01", basis: "ceiling" as const }];
    expect(pfWageBasisFor(undefined, "2026-12")).toBe("ceiling");
    expect(pfWageBasisFor(rows, "2026-11")).toBe("ceiling");
    expect(pfWageBasisFor(rows, "2026-12")).toBe("actual");
    expect(pfWageBasisFor(rows, "2027-03")).toBe("actual");
    expect(pfWageBasisFor(rows, "2027-04")).toBe("ceiling");
  });
});

describe("SEAM 2: Labour Welfare Fund", () => {
  const base = consolidatedEpf({ basicMinor: R(30_000) });
  it("omitted: no LWF line and no result fields", () => {
    const r = computeSlip(base);
    expect(line(r, "LWF")).toBeUndefined();
    expect("lwfEmployeeMinor" in r).toBe(false);
  });
  it("applied: fixed deduction of the employee share, employer share reported, gross and PF unchanged", () => {
    const off = computeSlip(base);
    const on = computeSlip({ ...base, lwf: { employeeMinor: R(20), employerMinor: R(40) } });
    expect(line(on, "LWF")).toBe(R(20));
    expect(on.lwfEmployeeMinor).toBe(R(20));
    expect(on.lwfEmployerMinor).toBe(R(40));
    expect(on.grossMinor).toBe(off.grossMinor);
    expect(on.pfEmployeeMinor).toBe(off.pfEmployeeMinor);
    expect(on.totalDeductionsMinor).toBe(off.totalDeductionsMinor + R(20));
    expect(on.netPayMinor).toBe(off.netPayMinor - R(20));
  });
  it("employer-only rule: no employee line, employer share still reported", () => {
    const r = computeSlip({ ...base, lwf: { employeeMinor: 0n, employerMinor: R(40) } });
    expect(line(r, "LWF")).toBeUndefined();
    expect(r.lwfEmployerMinor).toBe(R(40));
  });
  it("lwfDueForMonth follows the frequency (VERIFY placeholder months) and skips empty rules", () => {
    const rule = (frequency: "monthly" | "quarterly" | "half_yearly" | "yearly") => ({ employeeMinor: 2_000n, employerMinor: 4_000n, frequency });
    expect(lwfDueForMonth(undefined, "2026-12")).toBeNull();
    expect(lwfDueForMonth(rule("monthly"), "2026-07")).toEqual({ employeeMinor: 2_000n, employerMinor: 4_000n });
    expect(lwfDueForMonth(rule("quarterly"), "2026-09")).not.toBeNull();
    expect(lwfDueForMonth(rule("quarterly"), "2026-10")).toBeNull();
    expect(lwfDueForMonth(rule("half_yearly"), "2026-06")).not.toBeNull();
    expect(lwfDueForMonth(rule("half_yearly"), "2026-07")).toBeNull();
    expect(lwfDueForMonth(rule("yearly"), "2026-12")).not.toBeNull();
    expect(lwfDueForMonth(rule("yearly"), "2026-06")).toBeNull();
    expect(lwfDueForMonth({ employeeMinor: 0n, employerMinor: 0n, frequency: "monthly" }, "2026-12")).toBeNull();
  });
});

describe("SEAM 3: ESI contribution-period continuity", () => {
  const over = { basicMinor: R(24_000), payProfile: { kind: "consolidated_contract" as const }, pensionScheme: "EPF" as const };
  it("gross over the ceiling and no continuation: no ESI (today)", () => {
    const r = computeSlip(over);
    expect(r.esiMinor).toBe(0n);
    expect(r.esiEmployerMinor).toBe(0n);
  });
  it("continuation: ESI on the whole gross 24,000 -> employee 0.75% = 180, employer 3.25% = 780", () => {
    const r = computeSlip({ ...over, esiContinuation: true });
    expect(r.esiMinor).toBe(R(180));
    expect(r.esiEmployerMinor).toBe(R(780));
  });
  it("continuation never overrides the engagement gate", () => {
    expect(computeSlip({ ...over, esiContinuation: true, statutoryEsi: false }).esiMinor).toBe(0n);
  });
  it("continuation under the ceiling is a no-op", () => {
    const under = { basicMinor: R(15_000), payProfile: { kind: "consolidated_contract" as const }, pensionScheme: "EPF" as const };
    expect(computeSlip({ ...under, esiContinuation: true })).toEqual(computeSlip(under));
  });
  it("contribution periods are Apr-Sep and Oct-Mar", () => {
    expect(esiContributionPeriodStart("2026-04")).toBe("2026-04");
    expect(esiContributionPeriodStart("2026-09")).toBe("2026-04");
    expect(esiContributionPeriodStart("2026-10")).toBe("2026-10");
    expect(esiContributionPeriodStart("2027-03")).toBe("2026-10");
    expect(esiContributionPeriodStart("2027-01")).toBe("2026-10");
  });
  it("esiContinuesInPeriod: only an earlier covered month of the SAME period counts", () => {
    expect(esiContinuesInPeriod("2026-08", ["2026-06"])).toBe(true);
    expect(esiContinuesInPeriod("2026-10", ["2026-09"])).toBe(false); // new period
    expect(esiContinuesInPeriod("2027-02", ["2026-11"])).toBe(true);
    expect(esiContinuesInPeriod("2026-08", [])).toBe(false);
    expect(esiContinuesInPeriod("2026-08", undefined)).toBe(false);
    expect(esiContinuesInPeriod("2026-08", ["2026-08"])).toBe(false); // this month itself is not memory
  });
});

describe("deploy-order safety: code deployed before migration 0167", () => {
  it("missing tables mean seams OFF and empty PF basis, logged once, never an error", async () => {
    const repo = await import("../src/modules/payroll/statutory-seams-repo.js");
    repo.resetSeamTablesMissingLogForTest();
    const warn = vi.spyOn(repo.seamLog, "warn").mockImplementation(() => undefined);
    const tx = { execute: vi.fn(async () => [{ ok: false }]) } as never;
    expect(await repo.resolveSeamFlags(tx, "t")).toEqual({ lwfDeductionEnabled: false, esiContributionPeriodEnabled: false });
    expect((await repo.pfWageBasisRowsByEmployee(tx, "t", ["e1"])).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
