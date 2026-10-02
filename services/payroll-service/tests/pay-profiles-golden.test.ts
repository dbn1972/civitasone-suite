/**
 * PAY-PROFILES (PR2) golden payslips + boundaries, all hand-computed
 * (design doc PAY-PROFILES-DESIGN.md §7). Default statutory config, new
 * regime FY 2025 (std deduction ₹75,000, Sec 87A rebate to ₹12L taxable), so
 * TDS is 0 in every golden; PT is supplied explicitly. Amounts in paise.
 */
import { describe, it, expect } from "vitest";
import {
  computeSlip, govtHraMinor, deputationAllowanceMinor, type SlipInput, type DeputationAllowanceInput,
} from "../src/modules/payroll/domain.js";
import { hraExemptionMinor } from "../src/modules/tax/engine.js";
import {
  resolveAllowanceRules, NO_ALLOWANCE_RULES, type AllowanceRuleRow, type AllowanceRules,
} from "../src/modules/pay-profiles/allowance-rules.js";
import { planEmployeePay } from "../src/modules/pay-profiles/plan.js";
import { hraFloorImpact, payrollPreflight, foreignServiceReport } from "../src/modules/pay-profiles/reports.js";
import { separationPayProfile, eventPayProfileRow } from "../src/modules/integration/consumer.js";
import { computeSubsistenceEarnings, planSubsistence, resolveProfiledSuspension, DEFAULT_SUBSISTENCE_CONFIG } from "../src/modules/payroll/subsistence.js";
import type { PayrollInputEmployee, PayProfileFeed, DeputationFeed } from "../src/shared/hrms-client.js";

const base = (o: Partial<SlipInput>): SlipInput => ({ taxRegime: "new", fyStartYear: 2025, ...o } as SlipInput);
const line = (r: ReturnType<typeof computeSlip>, code: string) =>
  [...r.earnings, ...r.deductions].find((c) => c.code === code)?.amountMinor;

describe("G1 govt_scale -- backward-compatibility anchor", () => {
  it("basic 56,100 / DA 55% / X / NPS / PT 200: net 94,889", () => {
    const r = computeSlip(base({ basicMinor: 5_610_000n, daRateBps: 5500n, cityClass: "X", pensionScheme: "NPS", ptMinor: 20_000n, hraFloorMinor: 540_000n }));
    expect(line(r, "DA")).toBe(3_085_500n);
    expect(r.hraMinor).toBe(1_683_000n);           // 30% slab, above the 5,400 floor
    expect(r.grossMinor).toBe(10_378_500n);
    expect(r.npsEmployeeMinor).toBe(869_600n);     // 10% of 86,955 = 8,695.5 -> 8,696
    expect(r.npsEmployerMinor).toBe(1_217_400n);   // 14% -> 12,173.7 -> 12,174
    expect(r.esiMinor).toBe(0n);
    expect(r.tdsMinor).toBe(0n);
    expect(r.totalDeductionsMinor).toBe(889_600n);
    expect(r.netPayMinor).toBe(9_488_900n);
  });
});

describe("G2 HRA floor binds (DA 0 tier)", () => {
  it.each([["X", 540_000n, 360_000n], ["Y", 360_000n, 240_000n], ["Z", 180_000n, 120_000n]] as const)(
    "%s: slab -> floor", (city, floor, slab) => {
      const floored = computeSlip(base({ basicMinor: 1_500_000n, cityClass: city, pensionScheme: "NPS", hraFloorMinor: floor }));
      const legacy = computeSlip(base({ basicMinor: 1_500_000n, cityClass: city, pensionScheme: "NPS" }));
      expect(legacy.hraMinor).toBe(slab);
      expect(floored.hraMinor).toBe(floor);
      expect(floored.grossMinor - legacy.grossMinor).toBe(floor - slab);
    });
});

const autoOther: DeputationAllowanceInput = { mode: "auto", fixedMinor: 0n, stationType: "other", rule: { rateBps: 1000n, capMinor: 900_000n } };

describe("G3 deputation_parent_scale (Option A)", () => {
  const g3 = (allowance: DeputationAllowanceInput, basicMinor = 4_490_000n) => computeSlip(base({
    basicMinor, daRateBps: 5500n, cityClass: "Y", pensionScheme: "GPF", hraFloorMinor: 360_000n,
    payProfile: { kind: "deputation_parent_scale", allowance },
  }));
  it("other station 10% / cap 9,000: DEP_ALLOW 4,490, gross 83,065, net 76,105; allowance outside the pension base", () => {
    const r = g3(autoOther);
    expect(line(r, "DA")).toBe(2_469_500n);
    expect(r.hraMinor).toBe(898_000n);
    expect(line(r, "DEP_ALLOW")).toBe(449_000n);
    expect(r.grossMinor).toBe(8_306_500n);
    expect(r.gpfMinor).toBe(696_000n);             // 10% of (44,900 + 24,695) only
    expect(r.netPayMinor).toBe(7_610_500n);
  });
  it("same station 5% / cap 4,500: DEP_ALLOW 2,245, net 73,860", () => {
    const r = g3({ ...autoOther, stationType: "same", rule: { rateBps: 500n, capMinor: 450_000n } });
    expect(line(r, "DEP_ALLOW")).toBe(224_500n);
    expect(r.netPayMinor).toBe(7_386_000n);
  });
  it("cap binds: basic 1,00,000 other station -> 9,000 (not 10,000)", () => {
    expect(line(g3(autoOther, 10_000_000n), "DEP_ALLOW")).toBe(900_000n);
  });
  it("per-employee override (fixed) wins over the rule; auto without a rule pays the order amount", () => {
    expect(line(g3({ ...autoOther, mode: "fixed", fixedMinor: 300_000n }), "DEP_ALLOW")).toBe(300_000n);
    expect(line(g3({ ...autoOther, rule: null, fixedMinor: 250_000n }), "DEP_ALLOW")).toBe(250_000n);
    expect(line(g3({ ...autoOther, rule: null, fixedMinor: 0n }), "DEP_ALLOW")).toBeUndefined();
  });
});

describe("G4 deputation_post_scale (Option B)", () => {
  it("post basic 47,600 / DA 55% / Z / NPS: no allowance, net 71,162", () => {
    const r = computeSlip(base({ basicMinor: 4_760_000n, daRateBps: 5500n, cityClass: "Z", pensionScheme: "NPS", hraFloorMinor: 180_000n, payProfile: { kind: "deputation_post_scale" } }));
    expect(line(r, "DA")).toBe(2_618_000n);
    expect(r.hraMinor).toBe(476_000n);
    expect(line(r, "DEP_ALLOW")).toBeUndefined();
    expect(r.grossMinor).toBe(7_854_000n);
    expect(r.npsEmployeeMinor).toBe(737_800n);
    expect(r.npsEmployerMinor).toBe(1_032_900n);   // 10,329.2 -> 10,329
    expect(r.netPayMinor).toBe(7_116_200n);
  });
});

describe("G7 consolidated_contract", () => {
  const g7 = (o: Partial<SlipInput>) => computeSlip(base({ payProfile: { kind: "consolidated_contract" }, pensionScheme: "NPS", cityClass: "X", daRateBps: 5500n, hraFloorMinor: 540_000n, ...o }));
  it("30,000, PF+ESI engagement, HRMS scheme NPS: EPF not NPS, no DA/HRA, net 28,000", () => {
    const r = g7({ basicMinor: 3_000_000n, ptMinor: 20_000n });
    expect(r.earnings).toEqual([{ code: "BASIC", name: "Consolidated Emoluments", type: "earning", amountMinor: 3_000_000n }]);
    expect(r.daMinor).toBe(0n);
    expect(r.hraMinor).toBe(0n);
    expect(r.npsEmployeeMinor).toBe(0n);
    expect(r.pfEmployeeMinor).toBe(180_000n);
    expect(r.pfEmployerMinor).toBe(180_000n);
    expect(r.epsMinor).toBe(125_000n);
    expect(r.epfEmployerMinor).toBe(55_000n);
    expect(r.esiMinor).toBe(0n);
    expect(r.netPayMinor).toBe(2_800_000n);
  });
  it("20,000: ESI 150 / employer 650, net 18,050", () => {
    const r = g7({ basicMinor: 2_000_000n });
    expect(r.esiMinor).toBe(15_000n);
    expect(r.esiEmployerMinor).toBe(65_000n);
    expect(r.netPayMinor).toBe(1_805_000n);
  });
  it("engagement without PF: no PF and (forced EPF scheme) no NPS either", () => {
    const r = g7({ basicMinor: 3_000_000n, statutoryPf: false });
    expect(r.pfEmployeeMinor + r.npsEmployeeMinor + r.gpfMinor).toBe(0n);
  });
});

describe("G8 Sec 10(13A) with the floor", () => {
  it("old regime, basic 15,000, DA 0, X, rent 1,20,000: exemption 64,800 (pre-floor 43,200)", () => {
    const floored = govtHraMinor(1_500_000n, "X", 0n, 540_000n) * 12n;
    const legacy = govtHraMinor(1_500_000n, "X", 0n) * 12n;
    expect(hraExemptionMinor(18_000_000n, floored, 12_000_000n, true)).toBe(6_480_000n);
    expect(hraExemptionMinor(18_000_000n, legacy, 12_000_000n, true)).toBe(4_320_000n);
  });
  it("computeSlip's own old-regime exemption uses the floored HRA too", () => {
    const decl = { rentPaidAnnualMinor: 12_000_000n };
    const legacy = computeSlip(base({ basicMinor: 1_500_000n, cityClass: "X", taxRegime: "old", declaration: decl, pensionScheme: "NPS" }));
    const floored = computeSlip(base({ basicMinor: 1_500_000n, cityClass: "X", taxRegime: "old", declaration: decl, pensionScheme: "NPS", hraFloorMinor: 540_000n }));
    // gross rises by 1,800/month but the extra is fully exempt (64,800 - 43,200 = 21,600 = 1,800 x 12)
    expect(floored.annualTaxableMinor).toBe(legacy.annualTaxableMinor);
  });
});

describe("HRA floor boundaries", () => {
  it("slab exactly at the floor stays the slab; one step below takes the floor", () => {
    expect(govtHraMinor(2_250_000n, "X", 0n, 540_000n)).toBe(540_000n);
    expect(govtHraMinor(2_240_000n, "X", 0n, 540_000n)).toBe(540_000n);   // slab 5,376 -> floor
    expect(govtHraMinor(2_240_000n, "X", 0n)).toBe(537_600n);
    expect(govtHraMinor(1_800_000n, "X", 5500n, 540_000n)).toBe(540_000n); // 30% of 18,000 == floor
    expect(govtHraMinor(1_790_000n, "X", 5500n, 540_000n)).toBe(540_000n); // slab 5,370 -> floor
  });
  it("zero basic never attracts the floor; floor 0 == no floor", () => {
    expect(govtHraMinor(0n, "X", 5500n, 540_000n)).toBe(0n);
    expect(govtHraMinor(1_000_000n, "Y", 0n, 0n)).toBe(160_000n);
  });
  it.each([[2499n, 540_000n], [2500n, 540_000n], [4999n, 540_000n], [5000n, 600_000n]])(
    "DA %s bps tiers with floor (basic 20,000, X)", (da, hra) => {
      expect(govtHraMinor(2_000_000n, "X", da, 540_000n)).toBe(hra);
    });
});

describe("deputationAllowanceMinor", () => {
  it("pct exactly at the cap, rounding, basis", () => {
    expect(deputationAllowanceMinor(9_000_000n, autoOther)).toEqual({ amountMinor: 900_000n, basis: "computed" });
    expect(deputationAllowanceMinor(4_490_050n, autoOther)).toEqual({ amountMinor: 449_000n, basis: "computed" }); // 4,490.005 -> 4,490
    expect(deputationAllowanceMinor(4_490_000n, { ...autoOther, stationType: null })).toEqual({ amountMinor: 0n, basis: "fixed" });
  });
});

describe("ctc_contract is not computed by this PR", () => {
  it("computeSlip refuses it", () => {
    expect(() => computeSlip(base({ basicMinor: 1n, payProfile: { kind: "ctc_contract" } as unknown as SlipInput["payProfile"] }))).toThrow(/CTC_PROFILE_NOT_SUPPORTED/);
  });
});

// ── allowance rules ────────────────────────────────────────────────────────
const T = "11111111-1111-4111-8111-111111111111";
const row = (o: Partial<AllowanceRuleRow>): AllowanceRuleRow => ({
  tenantId: null, effectiveFrom: "2026-11-01", hraFloorXMinor: null, hraFloorYMinor: null, hraFloorZMinor: null,
  depSameBps: null, depSameCapMinor: null, depOtherBps: null, depOtherCapMinor: null, ...o,
});

describe("resolveAllowanceRules (field-level inheritance)", () => {
  const rows = [
    row({ hraFloorXMinor: 540_000n, hraFloorYMinor: 360_000n, hraFloorZMinor: 180_000n }),
    row({ tenantId: T, effectiveFrom: "2027-01-01", hraFloorXMinor: 0n, depOtherBps: 1000n, depOtherCapMinor: 900_000n }),
    row({ tenantId: "someone-else", effectiveFrom: "2026-12-01", hraFloorYMinor: 999n }),
  ];
  it("before go-live: nothing", () => {
    expect(resolveAllowanceRules(rows, T, "2026-10")).toEqual(NO_ALLOWANCE_RULES);
  });
  it("from go-live: platform floors", () => {
    const r = resolveAllowanceRules(rows, T, "2026-11");
    expect(r.hraFloorMinor).toEqual({ X: 540_000n, Y: 360_000n, Z: 180_000n });
    expect(r.sources.hraFloor.X).toBe("platform");
  });
  it("a tenant row overrides only the fields it sets (X disabled), others inherit; another tenant never leaks", () => {
    const r = resolveAllowanceRules(rows, T, "2027-02");
    expect(r.hraFloorMinor).toEqual({ X: 0n, Y: 360_000n, Z: 180_000n });
    expect(r.sources.hraFloor).toEqual({ X: "tenant", Y: "platform", Z: "platform" });
    expect(r.deputation).toEqual({ same: null, other: { rateBps: 1000n, capMinor: 900_000n } });
  });
});

// ── pay plans ──────────────────────────────────────────────────────────────
const RULES: AllowanceRules = resolveAllowanceRules([
  row({ hraFloorXMinor: 540_000n, hraFloorYMinor: 360_000n, hraFloorZMinor: 180_000n, depSameBps: 500n, depSameCapMinor: 450_000n, depOtherBps: 1000n, depOtherCapMinor: 900_000n }),
], T, "2026-11");

const dep = (o: Partial<DeputationFeed> = {}): DeputationFeed => ({
  id: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", status: "active", direction: "in", option: "parent_scale", stationType: "other",
  parentCadre: "CSS", parentOrganisation: "Ministry X", parentPayLevel: 7, parentBasicMinor: "4490000",
  postPayLevel: null, postBasicMinor: null, allowanceMode: "auto", fixedAllowanceMinor: "0", foreignService: false,
  parentPensionScheme: "GPF", daSource: "central", parentDaRateBps: null, tenureFrom: "2026-10-15", tenureTo: "2029-10-14", ...o,
});
const prof = (o: Partial<PayProfileFeed>): PayProfileFeed => ({
  profile: "govt_scale", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", effectiveFrom: "2026-11-01", changedWithinMonth: false, ...o,
});
const emp = (o: Partial<PayrollInputEmployee> = {}): PayrollInputEmployee => ({
  id: "e1", employeeNo: "E-1", fullName: "One", basicMinor: "3000000", dateOfJoining: "2020-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, cityClass: "Y", taxRegime: "new", departmentId: "d1",
  pensionScheme: "NPS", ...o,
});

describe("planEmployeePay", () => {
  it("no profile: exactly the legacy inputs", () => {
    const r = planEmployeePay(emp(), "2026-11", 5500n, NO_ALLOWANCE_RULES);
    expect(r).toMatchObject({ ok: true, plan: {
      profile: "govt_scale", slipProfile: { kind: "govt_scale" }, profileBasicMinor: 3_000_000n, applyRevisions: true,
      applyRunStructure: true, lopMode: "deduction", daRateBps: 5500n, pensionScheme: "NPS", hraFloorMinor: 0n,
    } });
  });
  it("govt_scale picks up the floor for the employee's city class", () => {
    const r = planEmployeePay(emp(), "2026-11", 5500n, RULES);
    expect(r.ok && r.plan.hraFloorMinor).toBe(360_000n);
  });
  it("Option A: parent basic, parent pension scheme, the station's rule", () => {
    const r = planEmployeePay(emp({ payProfile: prof({ profile: "deputation_parent_scale", deputation: dep() }) }), "2026-11", 5500n, RULES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.profileBasicMinor).toBe(4_490_000n);
    expect(r.plan.pensionScheme).toBe("GPF");
    expect(r.plan.slipProfile).toEqual({ kind: "deputation_parent_scale", allowance: { mode: "auto", fixedMinor: 0n, stationType: "other", rule: { rateBps: 1000n, capMinor: 900_000n } } });
    expect(r.plan.snapshot).toMatchObject({ direction: "in", allowanceBasis: "computed", daSource: "central" });
  });
  it("repatriated DURING the month: that month is still paid under the deputation", () => {
    const r = planEmployeePay(emp({ payProfile: prof({ profile: "deputation_parent_scale", deputation: dep({ status: "repatriated", repatriatedOn: "2026-11-20" }) }) }), "2026-11", 5500n, RULES);
    expect(r.ok).toBe(true);
  });
  it("parent-State DA source uses the recorded rate", () => {
    const r = planEmployeePay(emp({ payProfile: prof({ profile: "deputation_parent_scale", deputation: dep({ daSource: "parent", parentDaRateBps: 4600 }) }) }), "2026-11", 5500n, RULES);
    expect(r.ok && r.plan.daRateBps).toBe(4600n);
  });
  it("Option B uses the post basic; consolidated is pro-rated, no revisions, EPF, no floor", () => {
    const b = planEmployeePay(emp({ payProfile: prof({ profile: "deputation_post_scale", deputation: dep({ option: "post_scale", postBasicMinor: "4760000" }) }) }), "2026-11", 5500n, RULES);
    expect(b.ok && b.plan.profileBasicMinor).toBe(4_760_000n);
    const c = planEmployeePay(emp({ payProfile: prof({ profile: "consolidated_contract", consolidatedMonthlyMinor: "3000000" }) }), "2026-11", 5500n, RULES);
    expect(c).toMatchObject({ ok: true, plan: { profileBasicMinor: 3_000_000n, applyRevisions: false, applyRunStructure: false, lopMode: "prorate", pensionScheme: "EPF", hraFloorMinor: 0n, daRateBps: 0n } });
  });
  it.each([
    ["ctc not yet supported", prof({ profile: "ctc_contract" }), "CTC_PROFILE_NOT_SUPPORTED"],
    ["consolidated without amount", prof({ profile: "consolidated_contract" }), "CONSOLIDATED_AMOUNT_MISSING"],
    ["deputation without terms", prof({ profile: "deputation_parent_scale" }), "DEPUTATION_TERMS_MISSING"],
    ["option mismatch", prof({ profile: "deputation_post_scale", deputation: dep() }), "DEPUTATION_OPTION_MISMATCH"],
    ["tenure ended", prof({ profile: "deputation_parent_scale", deputation: dep({ tenureTo: "2026-10-31" }) }), "DEPUTATION_NOT_IN_FORCE"],
    ["cancelled", prof({ profile: "deputation_parent_scale", deputation: dep({ status: "cancelled" }) }), "DEPUTATION_NOT_IN_FORCE"],
    ["repatriated before the month (profile left open)", prof({ profile: "deputation_parent_scale", deputation: dep({ status: "repatriated", repatriatedOn: "2026-10-20" }) }), "DEPUTATION_NOT_IN_FORCE"],
    ["repatriated, date unknown", prof({ profile: "deputation_parent_scale", deputation: dep({ status: "repatriated", repatriatedOn: null }) }), "DEPUTATION_NOT_IN_FORCE"],
    ["post basic missing", prof({ profile: "deputation_post_scale", deputation: dep({ option: "post_scale" }) }), "POST_BASIC_REQUIRED"],
    ["parent basic missing (deputed-in)", prof({ profile: "deputation_parent_scale", deputation: dep({ parentBasicMinor: null }) }), "PARENT_BASIC_REQUIRED"],
    ["parent DA without rate", prof({ profile: "deputation_parent_scale", deputation: dep({ daSource: "parent" }) }), "PARENT_DA_RATE_REQUIRED"],
  ])("fails closed: %s", (_l, payProfile, code) => {
    const r = planEmployeePay(emp({ payProfile }), "2026-11", 5500n, RULES);
    expect(r).toMatchObject({ ok: false, code });
    if (!r.ok) expect(r.message).toContain("E-1");
  });
});

describe("separationPayProfile (F&F)", () => {
  it("legacy slip (no profile): unchanged settlement", () => {
    expect(separationPayProfile(null)).toEqual({ finalSalaryOnly: false, noCentralDa: false, eligibleForGratuity: true, leaveEncashmentEligible: true, consolidatedMonthlyMinor: null, daRateBpsOverride: null });
  });
  it("no slip yet: the separation event's own profile summary is used", () => {
    expect(eventPayProfileRow(undefined)).toBeNull();
    expect(separationPayProfile(eventPayProfileRow({ profile: "deputation_parent_scale", deputationDirection: "in" })).finalSalaryOnly).toBe(true);
    expect(separationPayProfile(eventPayProfileRow({ profile: "consolidated_contract", consolidatedMonthlyMinor: "3000000" })))
      .toMatchObject({ noCentralDa: true, consolidatedMonthlyMinor: 3_000_000n, leaveEncashmentEligible: false });
  });
  it("deputed-IN: final salary only; parent-State DA carried", () => {
    expect(separationPayProfile({ pay_profile: "deputation_parent_scale", profile_snapshot: { direction: "in", daSource: "parent", daRateBps: "4600" } }))
      .toMatchObject({ finalSalaryOnly: true, daRateBpsOverride: 4600n });
    expect(separationPayProfile({ pay_profile: "deputation_post_scale", profile_snapshot: { direction: "out" } }).finalSalaryOnly).toBe(false);
  });
  it("consolidated: no central DA, wages = consolidated amount; gratuity gate", () => {
    expect(separationPayProfile({ pay_profile: "consolidated_contract", profile_snapshot: { consolidatedMonthlyMinor: "3000000", eligibleForGratuity: false } }))
      .toEqual({ finalSalaryOnly: false, noCentralDa: true, eligibleForGratuity: false, leaveEncashmentEligible: false, consolidatedMonthlyMinor: 3_000_000n, daRateBpsOverride: null });
    // leave encashment for consolidated pay only when the engagement policy grants it (hrms 0065: contractual = true)
    expect(separationPayProfile({ pay_profile: "consolidated_contract", profile_snapshot: { leaveEncashmentEligible: true } }).leaveEncashmentEligible).toBe(true);
  });
});

describe("reports", () => {
  const staff = [
    emp({ id: "a", employeeNo: "A", basicMinor: "1500000", cityClass: "X" }),                                  // floor binds
    emp({ id: "b", employeeNo: "B", basicMinor: "5610000", cityClass: "X" }),                                  // does not
    emp({ id: "c", employeeNo: "C", payProfile: prof({ profile: "consolidated_contract", consolidatedMonthlyMinor: "1000000" }) }), // no HRA at all
    emp({ id: "d", employeeNo: "D", payProfile: prof({ profile: "ctc_contract" }) }),
    emp({ id: "e", employeeNo: "E", basicMinor: "1700000", cityClass: "Z", payProfile: prof({ profile: "deputation_parent_scale", deputation: dep({ parentBasicMinor: "1700000", foreignService: true, allowanceMode: "auto", stationType: "same" }) }) }),
  ];
  it("hraFloorImpact lists only employees the floor raises, with the monthly increase", () => {
    const r = hraFloorImpact(staff, "2026-11", 0n, RULES, new Map([["b", 5_610_000n]]));
    expect(r.rows.map((x) => [x.employeeNo, x.slabHraMinor, x.hraMinor, x.monthlyIncreaseMinor])).toEqual([
      ["A", "360000", "540000", "180000"],
      ["E", "136000", "180000", "44000"],
    ]);
    expect(r.totalMonthlyIncreaseMinor).toBe("224000");
    expect(r.employeesConsidered).toBe(3);
  });
  it("hraFloorImpact previews candidate floors", () => {
    expect(hraFloorImpact(staff, "2026-11", 0n, NO_ALLOWANCE_RULES, new Map(), { X: 400_000n }).rows.map((x) => x.employeeNo)).toEqual(["A"]);
  });
  it("preflight: ctc blocks; advisories become warnings", () => {
    const withAdvisory = [...staff, emp({ id: "f", employeeNo: "F", advisories: ["CONSOLIDATED_ENGAGEMENT_ON_GOVT_SCALE"] })];
    const r = payrollPreflight(withAdvisory, "2026-11", 5500n, RULES);
    expect(r.blocking).toBe(1);
    expect(r.issues.find((i) => i.severity === "blocking")).toMatchObject({ employeeNo: "D", code: "CTC_PROFILE_NOT_SUPPORTED" });
    expect(r.issues).toContainEqual(expect.objectContaining({ employeeNo: "F", code: "CONSOLIDATED_ENGAGEMENT_ON_GOVT_SCALE", severity: "warning" }));
  });
  it("preflight warns when no HRA floor is configured, and when an Option A allowance falls back to the fixed amount", () => {
    const r = payrollPreflight([staff[4]!], "2026-11", 5500n, NO_ALLOWANCE_RULES);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: "HRA_FLOOR_NOT_CONFIGURED", severity: "warning", employeeId: "" }),
      expect.objectContaining({ code: "DEPUTATION_ALLOWANCE_RULE_NOT_CONFIGURED", severity: "warning" }),
    ]);
    expect(payrollPreflight([], "2026-11", 5500n, RULES).issues).toEqual([]);
  });
  it("preflight: a suspended ctc / consolidated employee the run withholds is a WARNING, not blocking", () => {
    const suspended = { paySuspended: true, subsistencePct: 50, suspension: { suspensionId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", fromDate: "2026-11-10", toDate: null, revisedSubsistencePct: null, revisedEffectiveFrom: null, reviewOrderRef: null } };
    const ctc = { ...emp({ id: "k", employeeNo: "K", payProfile: prof({ profile: "ctc_contract" }) }), ...suspended };
    const cons = { ...emp({ id: "c", employeeNo: "C", payProfile: prof({ profile: "consolidated_contract", consolidatedMonthlyMinor: "3000000" }) }), ...suspended };
    const r = payrollPreflight([ctc, cons] as Parameters<typeof payrollPreflight>[0], "2026-11", 5500n, RULES);
    expect(r.blocking).toBe(0);
    expect(r.issues.map((i) => [i.employeeNo, i.severity, i.code])).toEqual([["K", "warning", "SUSPENDED_PAY_WITHHELD"], ["C", "warning", "SUSPENDED_PAY_WITHHELD"]]);
    // not suspended this month (starts next month) -> the ctc plan still blocks
    const later = { ...ctc, suspension: { ...suspended.suspension, fromDate: "2026-12-01" } };
    expect(payrollPreflight([later] as Parameters<typeof payrollPreflight>[0], "2026-11", 5500n, RULES).blocking).toBe(1);
  });
  it("preflight warns that parent-DA deputationists' retro arrears use the current parent rate", () => {
    const parentDa = emp({ id: "p", employeeNo: "P", payProfile: prof({ profile: "deputation_parent_scale", deputation: dep({ daSource: "parent", parentDaRateBps: 4600 }) }) });
    const r = payrollPreflight([parentDa], "2026-11", 5500n, RULES, new Map([["p", "2026-08-01"]]));
    expect(r.issues).toEqual([expect.objectContaining({ employeeNo: "P", code: "PARENT_DA_ARREARS_AT_CURRENT_RATE" })]);
    expect(payrollPreflight([parentDa], "2026-11", 5500n, RULES, new Map([["p", "2026-11-01"]])).issues).toEqual([]);
  });
  it("foreign-service report: flagged deputationists with the month's pay", () => {
    const rows = foreignServiceReport(staff, new Map([["e", { basicMinor: 1_700_000n, components: [{ code: "DA", amountMinor: 935_000 }] }]]));
    expect(rows).toEqual([expect.objectContaining({ employeeNo: "E", slipFound: true, basicMinor: "1700000", daMinor: "935000", contributionBaseMinor: "2635000", parentOrganisation: "Ministry X" })]);
  });
});

describe("FR 53 x PAY-PROFILES (pure)", () => {
  const susp = { paySuspended: true, subsistencePct: 50, suspension: { suspensionId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", fromDate: "2026-11-16", toDate: null, revisedSubsistencePct: null, revisedEffectiveFrom: null, reviewOrderRef: null } };
  const cfg = DEFAULT_SUBSISTENCE_CONFIG;
  it("no assigned profile: #1782's engagement rule is unchanged", () => {
    expect(resolveProfiledSuspension({ ...susp, payMode: "monthly", engagementType: "pay_scale" }, "2026-11", cfg).kind).toBe("subsistence");
    expect(resolveProfiledSuspension({ ...susp, payMode: "consolidated", engagementType: "contractual" }, "2026-11", cfg).kind).toBe("withhold");
    expect(resolveProfiledSuspension({ ...susp, payMode: "monthly", payProfile: { profile: "consolidated_contract", source: "default" } }, "2026-11", cfg).kind).toBe("subsistence");
  });
  it("assigned profile decides: govt/deputation -> subsistence; consolidated/ctc -> withheld + flagged; missing dates stay withheld", () => {
    expect(resolveProfiledSuspension({ ...susp, payMode: "consolidated", payProfile: { profile: "deputation_post_scale", source: "assigned" } }, "2026-11", cfg).kind).toBe("subsistence");
    for (const profile of ["consolidated_contract", "ctc_contract"]) {
      expect(resolveProfiledSuspension({ ...susp, payMode: "monthly", payProfile: { profile, source: "assigned" } }, "2026-11", cfg))
        .toMatchObject({ kind: "withhold", flags: ["NON_GOVERNMENT_ENGAGEMENT_WITHHELD"] });
    }
    expect(resolveProfiledSuspension({ paySuspended: true, payProfile: { profile: "govt_scale", source: "assigned" } }, "2026-11", cfg))
      .toMatchObject({ kind: "withhold", flags: ["SUSPENSION_DETAILS_MISSING"] });
    expect(resolveProfiledSuspension({ ...susp, suspension: { ...susp.suspension, fromDate: "2026-12-01" }, payProfile: { profile: "ctc_contract", source: "assigned" } }, "2026-11", cfg).kind).toBe("none");
  });
  it("subsistence lines: HRA floor applies; DEP_ALLOW pro-rated to regular days; omitted inputs == #1782's lines", () => {
    const plan = planSubsistence("2026-11", { suspensionId: "s", fromDate: "2026-11-16", toDate: null, revisedPct: null, revisedEffectiveFrom: null, reviewOrderRef: null }, cfg);
    const base = { basicMinor: 1_500_000n, daRateBps: 5500n, cityClass: "X" as const, rawComponents: [], plan };
    const legacy = computeSubsistenceEarnings(base);
    expect(legacy.hraMinor).toBe(450_000n);
    expect(computeSubsistenceEarnings({ ...base, hraFloorMinor: 0n, deputationAllowanceMinor: 0n })).toEqual(legacy);
    const floored = computeSubsistenceEarnings({ ...base, hraFloorMinor: 540_000n, deputationAllowanceMinor: 449_000n });
    expect(floored.hraMinor).toBe(540_000n);
    expect(floored.components.find((c) => c.code === "DEP_ALLOW")?.amountMinor).toBe(224_500n);
    expect(floored.pensionBaseMinor).toBe(legacy.pensionBaseMinor); // DEP_ALLOW stays outside the pension base
  });
});
