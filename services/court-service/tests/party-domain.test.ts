/** Pure-domain tests for party-role helpers + id derivation. */
import { describe, it, expect } from "vitest";
import { PARTY_ROLES, isValidRole, derivePartyId, presentParty, PII_PRIVILEGED_ROLES } from "../src/modules/party/domain.js";

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

describe("party domain — presentParty (DPDP PII masking)", () => {
  const row = {
    id: "p1",
    caseId: "c1",
    partyRole: "petitioner",
    nameEnc: "Ramesh Kumar Sharma",
    addressEnc: "12 MG Road, Lucknow",
    phoneEnc: "9876543210",
    emailEnc: "ramesh@example.com",
    advocateName: "Adv. Priya Singh",
    advocateBarId: "UP/1234/2010",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("reveals full cleartext PII when revealPii is true (privileged role)", () => {
    const out = presentParty(row, true);
    expect(out.name).toBe("Ramesh Kumar Sharma");
    expect(out.address).toBe("12 MG Road, Lucknow");
    expect(out.phone).toBe("9876543210");
    expect(out.email).toBe("ramesh@example.com");
    // Non-PII fields pass through unchanged regardless of role.
    expect(out.advocateName).toBe("Adv. Priya Singh");
    expect(out.partyRole).toBe("petitioner");
  });

  it("redacts name/address and masks phone/email when revealPii is false (ordinary role)", () => {
    const out = presentParty(row, false);
    expect(out.name).toBeNull();
    expect(out.address).toBeNull();
    expect(out.phone).not.toBe("9876543210");
    expect(out.phone).toMatch(/3210$/); // last 4 digits kept
    expect(out.email).not.toBe("ramesh@example.com");
    expect(out.email).toMatch(/@example\.com$/); // domain kept, local part masked
  });

  it("PII_PRIVILEGED_ROLES is the single source of truth shared with case-registry's embed", () => {
    expect(PII_PRIVILEGED_ROLES).toContain("judge");
    expect(PII_PRIVILEGED_ROLES).toContain("court_admin");
    expect(PII_PRIVILEGED_ROLES).toContain("super_admin");
    // registrar/court_clerk can read a case (COURT_READ_ROLES) but must NOT
    // be privileged for PII — this is the exact bug this module fixes.
    expect(PII_PRIVILEGED_ROLES).not.toContain("registrar");
    expect(PII_PRIVILEGED_ROLES).not.toContain("court_clerk");
  });
});
