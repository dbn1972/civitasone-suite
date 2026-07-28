/**
 * isKnownEngagementType — the employeeType membership check enforced at create.
 * Accepts canonical engagement categories, tenant-defined type-master codes, and
 * legacy defaults; rejects typos/unknowns.
 */
import { describe, it, expect } from "vitest";
import { isKnownEngagementType } from "../src/modules/employee/engagement-policy.js";

const canonical = new Set(["pay_scale", "contractual", "consultant", "third_party", "apprentice"]);
const tenant = new Set(["private_consultant", "fellow", "govt_deputation"]);

describe("isKnownEngagementType", () => {
  it("accepts a canonical DIC engagement category", () => {
    expect(isKnownEngagementType("consultant", canonical, tenant)).toBe(true);
    expect(isKnownEngagementType("third_party", canonical, tenant)).toBe(true);
    expect(isKnownEngagementType("apprentice", canonical, tenant)).toBe(true);
  });

  it("accepts a tenant-defined type-master code (would be wrongly rejected by a static enum)", () => {
    expect(isKnownEngagementType("private_consultant", canonical, tenant)).toBe(true);
    expect(isKnownEngagementType("fellow", canonical, tenant)).toBe(true);
  });

  it("accepts every legacy default code (backward compatible)", () => {
    for (const c of ["permanent", "temporary", "contract", "deputation", "intern", "apprentice", "volunteer"]) {
      expect(isKnownEngagementType(c, canonical, tenant)).toBe(true);
    }
  });

  it("rejects an unknown / typo'd code", () => {
    expect(isKnownEngagementType("consultnt", canonical, tenant)).toBe(false);
    expect(isKnownEngagementType("random_type", new Set(), new Set())).toBe(false);
    expect(isKnownEngagementType("", canonical, tenant)).toBe(false);
  });
});
