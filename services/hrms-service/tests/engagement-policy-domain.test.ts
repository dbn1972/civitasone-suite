/**
 * Engagement-policy resolver — pure unit tests (no DB).
 */
import { describe, it, expect } from "vitest";
import { toPolicy, resolvePolicy } from "../src/modules/employee/engagement-policy.js";

const canonConsultant = {
  category: "consultant", eligibleForLeave: false, eligibleForPayroll: false, eligibleForAppraisal: true,
  paymentRoute: "invoice", payMode: "none", taxSection: "194J",
  statutoryPf: false, statutoryEsi: false, statutoryNps: false,
  eligibleForGratuity: false, eligibleForBonus: false, leaveEncashment: false,
  defaultProbationMonths: 0, maxContractMonths: 36,
};

describe("toPolicy", () => {
  it("normalises a catalogue row", () => {
    const p = toPolicy(canonConsultant);
    expect(p.eligibleForPayroll).toBe(false);
    expect(p.paymentRoute).toBe("invoice");
    expect(p.taxSection).toBe("194J");
    expect(p.maxContractMonths).toBe(36);
  });
  it("applies safe defaults + null maxContract", () => {
    const p = toPolicy({ category: "x" });
    expect(p.paymentRoute).toBe("payroll");
    expect(p.taxSection).toBe("192");
    expect(p.maxContractMonths).toBeNull();
  });
});

describe("resolvePolicy", () => {
  it("tenant row wins over canonical", () => {
    const tenant = { ...canonConsultant, category: "consultant", eligibleForPayroll: true };
    const r = resolvePolicy("cn", tenant, canonConsultant);
    expect(r?.source).toBe("tenant");
    expect(r?.policy.eligibleForPayroll).toBe(true);
  });
  it("falls back to canonical when no tenant row", () => {
    const r = resolvePolicy("consultant", null, canonConsultant);
    expect(r?.source).toBe("canonical");
    expect(r?.policy.paymentRoute).toBe("invoice");
    expect(r?.category).toBe("consultant");
  });
  it("returns null when neither exists", () => {
    expect(resolvePolicy("ghost", null, null)).toBeNull();
  });
});
