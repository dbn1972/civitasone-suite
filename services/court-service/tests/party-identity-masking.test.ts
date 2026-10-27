/** Pure-domain tests for owner decision #32: party identity (name / Bar ID) reveal rules + masking. */
import { describe, it, expect } from "vitest";
import {
  presentParty, maskPartyName, maskBarId, IDENTITY_REVEAL_ROLES, PII_PRIVILEGED_ROLES, partiesRevealingIdentity,
} from "../src/modules/party/domain.js";

const row = {
  id: "p1", caseId: "c1", partyRole: "petitioner",
  nameEnc: "Ramesh Kumar Sharma", addressEnc: "12 MG Road, Lucknow", phoneEnc: "9876543210", emailEnc: "ramesh@example.com",
  advocateName: "Adv. Priya Singh", advocateBarId: "UP/1234/2010",
  version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("who may see party identity (owner decision #32)", () => {
  it("F12: only judge, registrar and court_admin reveal identity; court_clerk and every other role (incl. super_admin) do not", () => {
    expect([...IDENTITY_REVEAL_ROLES].sort()).toEqual(["court_admin", "judge", "registrar"]);
    expect(IDENTITY_REVEAL_ROLES).not.toContain("court_clerk");
    expect(IDENTITY_REVEAL_ROLES).not.toContain("super_admin");
  });
  it("identity reveal is wider than the address/phone/email PII list (registrar sees names, not contact details)", () => {
    expect(PII_PRIVILEGED_ROLES).not.toContain("registrar");
    expect(IDENTITY_REVEAL_ROLES).toContain("registrar");
  });
});

describe("masking helpers", () => {
  it("maskPartyName keeps each word's first character", () => {
    expect(maskPartyName("Ramesh Kumar Sharma")).toBe("R*** K*** S***");
    expect(maskPartyName("  Adv.  Priya Singh ")).toBe("A*** P*** S***");
    expect(maskPartyName("Q")).toBe("Q***");
  });
  it("maskPartyName / maskBarId pass null and empty through (nothing to mask is not a leak)", () => {
    expect(maskPartyName(null)).toBeNull();
    expect(maskPartyName("")).toBe("");
    expect(maskBarId(null)).toBeNull();
  });
  it("maskBarId keeps only the last four characters", () => {
    expect(maskBarId("UP/1234/2010")).toBe("********2010");
    expect(maskBarId("AB12")).toBe("****");
    expect(maskBarId("X")).toBe("****");
  });
  it("masked output never contains the original value", () => {
    expect(maskPartyName("Ramesh Kumar Sharma")).not.toContain("amesh");
    expect(maskBarId("UP/1234/2010")).not.toContain("1234");
  });
});

describe("presentParty with identity reveal", () => {
  it("identity roles see full name, advocate name and Bar ID; contact details follow the PII flag", () => {
    const out = presentParty(row, false, true);
    expect(out.name).toBe("Ramesh Kumar Sharma");
    expect(out.advocateName).toBe("Adv. Priya Singh");
    expect(out.advocateBarId).toBe("UP/1234/2010");
    expect(out.address).toBeNull();
    expect(out.phone).toMatch(/3210$/);
    expect(out.phone).not.toBe("9876543210");
    expect(out.email).not.toBe("ramesh@example.com");
  });
  it("everyone else sees masked name, advocate name and Bar ID", () => {
    const out = presentParty(row, false, false);
    expect(out.name).toBe("R*** K*** S***");
    expect(out.advocateName).toBe("A*** P*** S***");
    expect(out.advocateBarId).toBe("********2010");
    expect(JSON.stringify(out)).not.toContain("Ramesh");
    expect(JSON.stringify(out)).not.toContain("1234");
  });
  it("full PII implies full identity by default (judge / court_admin / super_admin)", () => {
    const out = presentParty(row, true);
    expect(out.name).toBe("Ramesh Kumar Sharma");
    expect(out.advocateBarId).toBe("UP/1234/2010");
    expect(out.address).toBe("12 MG Road, Lucknow");
  });
});

describe("partiesRevealingIdentity (what gets audited)", () => {
  it("lists only parties whose name / advocate / Bar ID is actually present and unmasked", () => {
    const bare = { ...row, id: "p2", nameEnc: null, advocateName: null, advocateBarId: null };
    expect(partiesRevealingIdentity([row, bare])).toEqual([{ id: "p1", fields: ["name", "advocateName", "advocateBarId"] }]);
    expect(partiesRevealingIdentity([bare])).toEqual([]);
  });
});
