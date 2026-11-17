import { describe, expect, it } from "vitest";
import {
  ADMIN_EDITIONS, MANIFEST_KEYS, PROFILES, RECRUITMENT_POLICIES, adminEditionFor, composesOnOnboard, getProfile,
} from "../src/index.js";

describe("B1 catalogue fields (data-keyed)", () => {
  it("every profile carries composeOnOnboard / adminEdition / recruitmentPolicy / manifestKey with valid values", () => {
    for (const p of PROFILES) {
      expect(typeof p.composeOnOnboard, p.code).toBe("boolean");
      expect(ADMIN_EDITIONS as readonly string[], p.code).toContain(p.adminEdition);
      expect(RECRUITMENT_POLICIES as readonly string[], p.code).toContain(p.recruitmentPolicy);
      expect(MANIFEST_KEYS as readonly string[], p.code).toContain(p.manifestKey);
    }
  });

  it("govt profiles map to admin edition govt_dept and are requisition-first", () => {
    for (const code of ["govt_dept", "govt_small_office"]) {
      const p = getProfile(code)!;
      expect(p.adminEdition).toBe("govt_dept");
      expect(p.recruitmentPolicy).toBe("requisition_first");
    }
  });

  it("govt_dept never composes on onboard; govt_small_office does (B2, migration 0064 bundle)", () => {
    expect(getProfile("govt_dept")!.composeOnOnboard).toBe(false);
    expect(composesOnOnboard("govt_dept")).toBe(false);
    expect(getProfile("govt_small_office")!.composeOnOnboard).toBe(true);
    expect(composesOnOnboard("govt_small_office")).toBe(true);
  });

  it("compose allow-list is the former NON_GOVT_PROFILES (section8, small_office, psu) plus govt_small_office", () => {
    expect(PROFILES.filter((p) => p.composeOnOnboard).map((p) => p.code).sort()).toEqual(["govt_small_office", "psu", "section8", "small_office"]);
    expect(composesOnOnboard("private")).toBe(false);
    expect(composesOnOnboard("nope")).toBe(false);
    expect(composesOnOnboard(null)).toBe(false);
    expect(composesOnOnboard(undefined)).toBe(false);
  });

  it("adminEditionFor: govt -> govt_dept, existing editions unchanged, section8 supported, unknown passes through", () => {
    expect(adminEditionFor("govt")).toBe("govt_dept");
    expect(adminEditionFor("psu")).toBe("psu");
    expect(adminEditionFor("small_office")).toBe("small_office");
    expect(adminEditionFor("section8")).toBe("section8");
    expect(adminEditionFor("private")).toBe("private");
    expect(adminEditionFor("martian")).toBe("martian");
  });

  it("ADMIN_EDITIONS is exactly the set of profile adminEdition values (no hand-maintained drift)", () => {
    expect([...new Set(PROFILES.map((p) => p.adminEdition))].sort()).toEqual([...ADMIN_EDITIONS].sort());
  });

  it("only the MSME profile uses the msme manifest", () => {
    expect(PROFILES.filter((p) => p.manifestKey === "msme").map((p) => p.code)).toEqual(["small_office"]);
  });
});
