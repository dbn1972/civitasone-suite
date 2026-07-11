/** Pure-domain tests for party-role helpers + id derivation. */
import { describe, it, expect } from "vitest";
import { PARTY_ROLES, isValidRole, derivePartyId } from "../src/modules/party/domain.js";

describe("party domain — roles + id derivation", () => {
  it("recognises canonical roles and rejects unknown ones", () => {
    expect(PARTY_ROLES).toContain("petitioner");
    expect(PARTY_ROLES).toContain("respondent");
    expect(isValidRole("advocate")).toBe(true);
    expect(isValidRole("intervenor")).toBe(true);
    expect(isValidRole("bystander")).toBe(false);
  });

  it("derivePartyId is deterministic per (tenant, case, role, seq)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    expect(derivePartyId(t, c, "petitioner", 0)).toBe(derivePartyId(t, c, "petitioner", 0));
    expect(derivePartyId(t, c, "petitioner", 0)).not.toBe(derivePartyId(t, c, "petitioner", 1));
    expect(derivePartyId(t, c, "petitioner", 0)).not.toBe(derivePartyId(t, c, "respondent", 0));
  });
});
