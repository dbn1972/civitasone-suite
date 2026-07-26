/**
 * CAP-084/085/086 adoption proof — citizen-service consumes
 * @civitasone/data-governance for consent, masking and erasure.
 */
import { describe, it, expect } from "vitest";
import {
  makeCitizenConsentRegistry, maskCitizenProfile, eraseCitizenProfile,
  CITIZEN_PROFILE_ERASURE_SET, CITIZEN_PROFILE_RETENTION, CITIZEN_PII_ROLES,
} from "../src/shared/data-governance.js";

describe("citizen consent (CAP-084)", () => {
  it("registers citizen purposes; service delivery is legitimate use", () => {
    const reg = makeCitizenConsentRegistry();
    expect(reg.hasConsent("cit-1", "service_delivery")).toBe(true);
    expect(reg.hasConsent("cit-1", "notifications")).toBe(false);
    reg.record("cit-1", "notifications", "granted");
    expect(reg.hasConsent("cit-1", "notifications")).toBe(true);
  });
});

describe("citizen masking (CAP-085)", () => {
  const profile = { id: "cit-1", name: "Asha", email: "asha@gov.in", mobile: "9998887777", address: "12 MG Rd", digilockerToken: "tok-xyz" };
  it("masks PII for non-privileged callers", () => {
    const m = maskCitizenProfile(profile, ["citizen"]);
    expect(m.name).toBe("Asha");            // name not in policy
    expect(m.email).toBe("a***@gov.in");
    expect(m.mobile).toBe("******7777");
    expect(m.address).toBe("********");
    expect(String(m.digilockerToken)).toMatch(/^sha256:/);
  });
  it("reveals PII to privileged officers", () => {
    const raw = maskCitizenProfile(profile, CITIZEN_PII_ROLES);
    expect(raw.email).toBe("asha@gov.in");
    expect(raw.mobile).toBe("9998887777");
  });
});

describe("citizen retention & erasure (CAP-086)", () => {
  it("defines a retention policy and erasure field-set", () => {
    expect(CITIZEN_PROFILE_RETENTION.category).toBe("citizen_profile");
    expect(CITIZEN_PROFILE_RETENTION.retainDays).toBeGreaterThan(0);
    expect(CITIZEN_PROFILE_ERASURE_SET.name).toBe("[DELETED]");
    expect(CITIZEN_PROFILE_ERASURE_SET.email).toBeNull();
  });
  it("erases PII object fields while preserving id", () => {
    const erased = eraseCitizenProfile({ id: "cit-1", name: "Asha", email: "asha@gov.in", mobile: "9998887777", digilockerToken: "t", address: "a" });
    expect(erased.id).toBe("cit-1");
    expect(erased.name).toBe("[erased]");
    expect(erased.email).toBe("[erased]");
  });
});
