/**
 * buildTypeResolver — pure resolver used to project each employee's engagement
 * policy into the payroll-input feed.
 *
 * Policy is imposed ONLY when a type is explicitly categorised into a canonical
 * category; un-categorised (category 'other') / legacy / unknown types stay
 * permissive, so the migration-defaulted statutory columns can never regress
 * existing payroll.
 */
import { describe, it, expect } from "vitest";
import { buildTypeResolver, DEFAULT_POLICY } from "../src/modules/employee/engagement-policy.js";

const canonical = [
  { category: "consultant", eligibleForPayroll: false, paymentRoute: "invoice", taxSection: "194J", statutoryPf: false, statutoryEsi: false, statutoryNps: false },
  { category: "apprentice", eligibleForPayroll: false, paymentRoute: "stipend", taxSection: "stipend", statutoryPf: false, statutoryEsi: false, statutoryNps: false },
  { category: "pay_scale", eligibleForPayroll: true, paymentRoute: "payroll", taxSection: "192", statutoryPf: true, statutoryEsi: true, statutoryNps: true },
];

describe("buildTypeResolver", () => {
  it("resolves a bare canonical category code to its policy", () => {
    const r = buildTypeResolver([], canonical);
    expect(r("consultant").eligibleForPayroll).toBe(false);
    expect(r("consultant").paymentRoute).toBe("invoice");
    expect(r("apprentice").paymentRoute).toBe("stipend");
    expect(r("pay_scale").statutoryNps).toBe(true);
  });

  it("a tenant type row maps its code to the canonical category policy", () => {
    const tenant = [{ code: "CN", category: "consultant" }];
    const r = buildTypeResolver(tenant, canonical);
    expect(r("CN").eligibleForPayroll).toBe(false);
    expect(r("CN").paymentRoute).toBe("invoice");
  });

  it("an un-categorised tenant row (category 'other') stays permissive — migration-default flags ignored", () => {
    const tenant = [{ code: "permanent", category: "other", statutoryNps: false, eligibleForPayroll: false }];
    const r = buildTypeResolver(tenant, canonical);
    expect(r("permanent")).toEqual(DEFAULT_POLICY);   // NOT the row's default-false flags
    expect(r("permanent").statutoryNps).toBe(true);
    expect(r("permanent").eligibleForPayroll).toBe(true);
  });

  it("falls back to the permissive default for legacy/unknown codes", () => {
    const r = buildTypeResolver([], canonical);
    expect(r("permanent")).toEqual(DEFAULT_POLICY);
    expect(r("contract").eligibleForPayroll).toBe(true);
    expect(r("").eligibleForPayroll).toBe(true);
  });
});
