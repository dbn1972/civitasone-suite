/**
 * FR 53 subsistence allowance -- pure rule + feed-boundary tests (no DB I/O).
 * The money paths end-to-end are in suspension-subsistence-real-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { parsePayrollInput, HrmsUnavailableError } from "../src/shared/hrms-client.js";
import {
  mergeSubsistenceSettings,
  planSubsistence, resolveSuspensionTreatment, isGovernmentPayScale, DEFAULT_SUBSISTENCE_CONFIG,
  type SuspensionWindow,
} from "../src/modules/payroll/subsistence.js";

const SUSP = {
  suspensionId: randomUUID(), fromDate: "2026-05-01", toDate: null,
  revisedSubsistencePct: null, revisedEffectiveFrom: null, reviewOrderRef: null,
};
const baseEmp = { id: "e1", employeeNo: "E1", basicMinor: "100" };
const feed = (emp: Record<string, unknown>) => ({ month: "2026-09", employees: [{ ...baseEmp, ...emp }], lopDays: {}, overtimeHours: {} });

describe("payroll-input feed boundary (zod)", () => {
  it("accepts a legacy feed with no suspension fields at all", () => {
    expect(parsePayrollInput(feed({})).employees[0]!.id).toBe("e1");
  });
  it("accepts a well-formed suspension and passes other fields through", () => {
    const out = parsePayrollInput(feed({ paySuspended: true, subsistencePct: 50, suspension: SUSP, cityClass: "X" }));
    expect(out.employees[0]).toMatchObject({ paySuspended: true, suspension: SUSP, cityClass: "X" });
  });
  it.each([
    ["paySuspended not a boolean", { paySuspended: "yes" }],
    ["subsistencePct over 100", { paySuspended: true, subsistencePct: 150 }],
    ["impossible date", { paySuspended: true, suspension: { ...SUSP, fromDate: "2026-02-30" } }],
    ["toDate before fromDate", { paySuspended: true, suspension: { ...SUSP, toDate: "2026-04-30" } }],
    ["review order effective before fromDate", { paySuspended: true, suspension: { ...SUSP, revisedSubsistencePct: 75, revisedEffectiveFrom: "2026-04-01" } }],
    ["revised % over 100", { paySuspended: true, suspension: { ...SUSP, revisedSubsistencePct: 101 } }],
    ["unknown suspension key", { paySuspended: true, suspension: { ...SUSP, payPct: 100 } }],
    ["suspension details on a non-suspended employee", { paySuspended: false, suspension: SUSP }],
  ])("rejects %s (fails the run, never guesses)", (_label, emp) => {
    expect(() => parsePayrollInput(feed(emp))).toThrow(HrmsUnavailableError);
  });
});

const W = (o: Partial<SuspensionWindow> = {}): SuspensionWindow => ({
  suspensionId: "s", fromDate: "2026-05-01", toDate: null, revisedPct: null, revisedEffectiveFrom: null, reviewOrderRef: null, ...o,
});

describe("planSubsistence (FR 53 day split)", () => {
  it("a review order outside the FR 53 band is NOT applied: stays at 50%, flagged", () => {
    const p = planSubsistence("2026-09", W({ revisedPct: 80 }));
    expect(p.segments).toEqual([{ pctBps: 5000n, days: 30 }]);
    expect(p.revisedPctBps).toBeNull();
    expect(p.flags.sort()).toEqual(["REVIEW_ORDER_DUE", "REVISED_PCT_OUT_OF_RANGE"]);
  });
  it("a valid order effective after day 91 applies from its date; the gap stays at 50% without a flag", () => {
    const p = planSubsistence("2026-09", W({ revisedPct: 75, revisedEffectiveFrom: "2026-09-21" }));
    expect(p.segments).toEqual([{ pctBps: 5000n, days: 20 }, { pctBps: 7500n, days: 10 }]);
    expect(p.flags).toEqual([]);
  });
  it("an order dated before day 91 still only applies from day 91", () => {
    const p = planSubsistence("2026-07", W({ fromDate: "2026-04-15", revisedPct: 25, revisedEffectiveFrom: "2026-05-01" }));
    // Day 91 from 2026-04-15 is 2026-07-14.
    expect(p.segments).toEqual([{ pctBps: 5000n, days: 13 }, { pctBps: 2500n, days: 18 }]);
  });
  it("a suspension ending mid-month pays regular pay for the days after it", () => {
    const p = planSubsistence("2026-09", W({ fromDate: "2026-09-05", toDate: "2026-09-24" }));
    expect(p).toMatchObject({ daysInMonth: 30, regularDays: 10, subsistenceDays: 20 });
  });
  it("uses the tenant's configured initial rate and flags a differing HRMS-recorded rate", () => {
    const p = planSubsistence("2026-09", W({ fromDate: "2026-09-01" }), { ...DEFAULT_SUBSISTENCE_CONFIG, initialPctBps: 4000n }, 50);
    expect(p.segments).toEqual([{ pctBps: 4000n, days: 30 }]);
    expect(p.flags).toEqual(["RECORDED_INITIAL_PCT_IGNORED"]);
  });
  it("handles February and leap years", () => {
    expect(planSubsistence("2028-02", W({ fromDate: "2028-02-10" }))).toMatchObject({ daysInMonth: 29, regularDays: 9, subsistenceDays: 20 });
  });
});

describe("resolveSuspensionTreatment", () => {
  const cfg = DEFAULT_SUBSISTENCE_CONFIG;
  it("not suspended -> none", () => {
    expect(resolveSuspensionTreatment({ paySuspended: false }, "2026-09", cfg)).toEqual({ kind: "none" });
  });
  it("suspension starting next month -> none (regular pay this month)", () => {
    expect(resolveSuspensionTreatment({ paySuspended: true, payMode: "monthly", suspension: { ...SUSP, fromDate: "2026-10-01" } }, "2026-09", cfg)).toEqual({ kind: "none" });
  });
  it("flagged without dates -> withhold (never full pay)", () => {
    expect(resolveSuspensionTreatment({ paySuspended: true, payMode: "monthly" }, "2026-09", cfg))
      .toEqual({ kind: "withhold", plan: null, flags: ["SUSPENSION_DETAILS_MISSING"] });
  });
  it.each([
    ["no payMode (older HRMS feed)", {}],
    ["consolidated contract pay", { payMode: "consolidated", engagementType: "contractual" }],
    ["legacy 'contract' type on a monthly pay mode", { payMode: "monthly", engagementType: "contract" }],
  ])("%s -> withhold + NON_GOVERNMENT_ENGAGEMENT_WITHHELD", (_l, extra) => {
    const t = resolveSuspensionTreatment({ paySuspended: true, suspension: SUSP, ...extra }, "2026-09", cfg);
    expect(t.kind).toBe("withhold");
    expect(t.kind === "withhold" && t.flags).toEqual(["NON_GOVERNMENT_ENGAGEMENT_WITHHELD"]);
  });
  it("pay-scale engagement -> subsistence", () => {
    expect(resolveSuspensionTreatment({ paySuspended: true, payMode: "monthly", engagementType: "pay_scale", suspension: SUSP }, "2026-09", cfg).kind).toBe("subsistence");
    expect(isGovernmentPayScale({ payMode: "monthly", engagementType: "permanent" })).toBe(true);
  });
});

describe("mergeSubsistenceSettings (partial PUT validated against stored values)", () => {
  const stored = DEFAULT_SUBSISTENCE_CONFIG; // 5000 / 90 / 2500 / 7500
  it("keeps stored values for omitted fields", () => {
    expect(mergeSubsistenceSettings(stored, { subsistenceInitialPctBps: 4000 }))
      .toEqual({ ok: true, config: { ...stored, initialPctBps: 4000n } });
  });
  it("rejects a lone min above the stored max", () => {
    expect(mergeSubsistenceSettings(stored, { subsistenceRevisedMinPctBps: 8000 }).ok).toBe(false);
  });
  it("rejects a lone max below the stored min", () => {
    expect(mergeSubsistenceSettings(stored, { subsistenceRevisedMaxPctBps: 2000 }).ok).toBe(false);
  });
  it("accepts moving both bounds together", () => {
    expect(mergeSubsistenceSettings(stored, { subsistenceRevisedMinPctBps: 8000, subsistenceRevisedMaxPctBps: 9000 }).ok).toBe(true);
  });
  it("rejects out-of-range values", () => {
    expect(mergeSubsistenceSettings(stored, { subsistenceReviewAfterDays: 0 }).ok).toBe(false);
    expect(mergeSubsistenceSettings(stored, { subsistenceInitialPctBps: 10001 }).ok).toBe(false);
  });
});
