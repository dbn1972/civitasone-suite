/**
 * DIC engagement-type LEAVE eligibility — the leave apply flow uses
 * leaveEligible() to decide whether an engagement type may draw on the salaried
 * (CCS/statutory) leave ledger. pay_scale/contractual/apprentice → eligible;
 * consultant (invoice) and third_party (agency) → not eligible.
 */
import { describe, it, expect } from "vitest";
import { buildTypeResolver, leaveEligible, DEFAULT_POLICY } from "../src/modules/employee/engagement-policy.js";

const canonical = [
  { category: "pay_scale",   eligibleForLeave: true },
  { category: "contractual", eligibleForLeave: true },
  { category: "apprentice",  eligibleForLeave: true },
  { category: "consultant",  eligibleForLeave: false },
  { category: "third_party", eligibleForLeave: false },
];

describe("leaveEligible", () => {
  it("permits salaried / apprentice types on the leave scheme", () => {
    const r = buildTypeResolver([], canonical);
    expect(leaveEligible(r("pay_scale"))).toBe(true);
    expect(leaveEligible(r("contractual"))).toBe(true);
    expect(leaveEligible(r("apprentice"))).toBe(true);
  });

  it("blocks invoice / agency types from the leave scheme", () => {
    const r = buildTypeResolver([], canonical);
    expect(leaveEligible(r("consultant"))).toBe(false);
    expect(leaveEligible(r("third_party"))).toBe(false);
  });

  it("defaults to eligible so pre-engagement-typing employees keep leave", () => {
    expect(DEFAULT_POLICY.eligibleForLeave).toBe(true);
    expect(leaveEligible(DEFAULT_POLICY)).toBe(true);
  });
});
