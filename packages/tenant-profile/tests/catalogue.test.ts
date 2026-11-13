import { describe, expect, it } from "vitest";
import {
  EDITIONS, LEGACY_SETTINGS, PROFILES, defaultProfileCode, describeProfile, effectiveSettings, getProfile,
  isProfileAllowedForEdition, tenantProfilesEnabled,
} from "../src/index.js";

describe("tenant-profile catalogue", () => {
  it("every edition has a default profile that exists and allows that edition", () => {
    for (const e of EDITIONS) {
      const code = defaultProfileCode(e);
      expect(getProfile(code), e).toBeDefined();
      expect(isProfileAllowedForEdition(code, e), e).toBe(true);
    }
  });
  it("govt maps to govt_dept; govt_small_office is a profile of edition govt, not an edition", () => {
    expect(defaultProfileCode("govt")).toBe("govt_dept");
    expect(isProfileAllowedForEdition("govt_small_office", "govt")).toBe(true);
    expect(isProfileAllowedForEdition("govt_small_office", "small_office")).toBe(false);
    expect((EDITIONS as readonly string[]).includes("govt_small_office")).toBe(false);
  });
  it("profile codes are unique and match the DB format check", () => {
    const codes = PROFILES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
  });
  it("owner decision 1: govt_small_office budget control is mandatory", () => {
    expect(getProfile("govt_small_office")!.settings.budgetControl).toBe("mandatory");
  });
  it("owner decision 4: govt_small_office has no default bill head; govt_dept keeps its fixed one", () => {
    expect(getProfile("govt_small_office")!.defaultBillHead).toBe("wizard");
    expect(getProfile("govt_dept")!.defaultBillHead).toBe("fixed");
  });
  it("owner decision 2: psu, private, ngo, cooperative behave as today, with the flag on too", () => {
    for (const c of ["psu", "private", "ngo", "cooperative", "small_office", "section8"]) {
      expect(getProfile(c)!.active, c).toBe(false);
      expect(effectiveSettings(c, true), c).toEqual(LEGACY_SETTINGS);
    }
  });
  it("flag off, or an unknown / absent code, resolves to the legacy settings", () => {
    expect(effectiveSettings("govt_small_office", false)).toBe(LEGACY_SETTINGS);
    expect(effectiveSettings("nope", true)).toBe(LEGACY_SETTINGS);
    expect(effectiveSettings(null, true)).toBe(LEGACY_SETTINGS);
  });
  it("govt_dept resolves to the legacy values even with the flag on", () => {
    expect(effectiveSettings("govt_dept", true)).toEqual(LEGACY_SETTINGS);
  });
  it("the flag defaults off and only the exact string 'true' turns it on", () => {
    expect(tenantProfilesEnabled({})).toBe(false);
    expect(tenantProfilesEnabled({ TENANT_PROFILES_ENABLED: "1" })).toBe(false);
    expect(tenantProfilesEnabled({ TENANT_PROFILES_ENABLED: "true" })).toBe(true);
  });
  it("describeProfile is active only when the flag is on", () => {
    expect(describeProfile("govt_small_office", false).active).toBe(false);
    expect(describeProfile("govt_small_office", true).active).toBe(true);
  });
  it("the legacy settings object is frozen", () => {
    expect(Object.isFrozen(LEGACY_SETTINGS)).toBe(true);
  });
});
