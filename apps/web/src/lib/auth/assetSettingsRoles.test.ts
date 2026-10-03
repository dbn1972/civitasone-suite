import { describe, it, expect } from "vitest";
import { canManageAssetSettings, canManageAssetCapitalisation } from "./workRoles";

describe("asset settings roles", () => {
  it("finance_admin manages the GL settings but not the capitalisation control", () => {
    expect(canManageAssetSettings(["finance_admin"])).toBe(true);
    expect(canManageAssetCapitalisation(["finance_admin"])).toBe(false);
    for (const r of ["asset_admin", "super_admin"]) {
      expect(canManageAssetSettings([r])).toBe(true);
      expect(canManageAssetCapitalisation([r])).toBe(true);
    }
    expect(canManageAssetSettings(["asset_manager"])).toBe(false);
  });
});
