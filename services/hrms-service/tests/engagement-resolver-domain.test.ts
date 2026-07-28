/**
 * buildTypeResolver — pure resolver used to project each employee's engagement
 * policy into the payroll-input feed. Precedence: tenant master → canonical → default.
 */
import { describe, it, expect } from "vitest";
import { buildTypeResolver, DEFAULT_POLICY } from "../src/modules/employee/engagement-policy.js";

const canonical = [
  { category: "consultant", eligibleForPayroll: false, paymentRoute: "invoice", taxSection: "194J", statutoryPf: false, statutoryEsi: false, statutoryNps: false },
  { category: "apprentice", eligibleForPayroll: false, paymentRoute: "stipend", taxSection: "stipend", statutoryPf: false, statutoryEsi: false, statutoryNps: false },
  { category: "pay_scale", eligibleForPayroll: true, paymentRoute: "payroll", taxSection: "192", statutoryPf: true, statutoryEsi: true, statutoryNps: true },
];

describe("buildTypeResolver", () => {
  it("resolves a canonical category code to its policy", () => {
    const r = buildTypeResolver([], canonical);
    expect(r("consultant").eligibleForPayroll).toBe(false);
    expect(r("consultant").paymentRoute).toBe("invoice");
    expect(r("apprentice").paymentRoute).toBe("stipend");
    expect(r("pay_scale").statutoryNps).toBe(true);
  });

  it("a tenant master row (by code) wins over canonical", () => {
    const tenant = [{ code: "CN", category: "consultant", eligibleForPayroll: true, paymentRoute: "payroll", statutoryPf: true, statutoryEsi: true, statutoryNps: false, taxSection: "192" }];
    const r = buildTypeResolver(tenant, canonical);
    expect(r("CN").eligibleForPayroll).toBe(true);   // tenant customised
    expect(r("consultant").eligibleForPayroll).toBe(false); // still canonical
  });

  it("falls back to the permissive default for legacy/unknown codes", () => {
    const r = buildTypeResolver([], canonical);
    expect(r("permanent")).toEqual(DEFAULT_POLICY);   // legacy — full payroll
    expect(r("contract").eligibleForPayroll).toBe(true);
    expect(r("").eligibleForPayroll).toBe(true);
  });
});
