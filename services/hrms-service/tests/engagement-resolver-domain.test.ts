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

  it("an un-categorised CUSTOM tenant row is trusted (admin config honored)", () => {
    // A tenant defines a bespoke type via CRUD, leaving category at the default
    // 'other' but explicitly configuring it as a non-payroll stipend type.
    const tenant = [{ code: "VF", category: "other", eligibleForPayroll: false, paymentRoute: "stipend", statutoryPf: false, statutoryEsi: false, statutoryNps: false, eligibleForGratuity: false, leaveEncashment: false }];
    const r = buildTypeResolver(tenant, canonical);
    expect(r("VF").eligibleForPayroll).toBe(false);     // admin's explicit config honored
    expect(r("VF").paymentRoute).toBe("stipend");
    expect(r("VF").eligibleForGratuity).toBe(false);
    expect(r("VF").leaveEncashment).toBe(false);
  });

  it("falls back to the permissive default only for codes with NO tenant row and NO canonical match", () => {
    const r = buildTypeResolver([], canonical);
    expect(r("permanent")).toEqual(DEFAULT_POLICY);
    expect(r("contract").eligibleForPayroll).toBe(true);
    expect(r("").eligibleForPayroll).toBe(true);
  });
});
