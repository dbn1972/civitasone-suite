import { describe, it, expect } from "vitest";
import { isModuleEnabled } from "./moduleVisibility";

describe("module visibility gating (R13.1, R13.2, R13.4)", () => {
  it("always shows modules with a null key (platform/overview)", () => {
    expect(isModuleEnabled([], null)).toBe(true);
    expect(isModuleEnabled(["finance"], null)).toBe(true);
  });

  it("shows all when enablement is unknown (null list)", () => {
    expect(isModuleEnabled(null, "finance")).toBe(true);
  });

  it("hides a disabled module", () => {
    expect(isModuleEnabled(["finance", "hrms"], "procurement")).toBe(false);
  });

  it("shows an enabled module, matching leniently across naming", () => {
    expect(isModuleEnabled(["finance"], "finance")).toBe(true);
    expect(isModuleEnabled(["hrms"], "hr")).toBe(true);
    expect(isModuleEnabled(["establishment"], "establishment")).toBe(true);
  });

  describe("super_admin override", () => {
    it("super_admin bypasses module gating", () => {
      expect(isModuleEnabled([], "finance", ["super_admin"])).toBe(true);
      expect(isModuleEnabled(["hrms"], "finance", ["super_admin"])).toBe(true);
    });

    it("platform_admin bypasses module gating", () => {
      expect(isModuleEnabled([], "procurement", ["platform_admin"])).toBe(true);
      expect(isModuleEnabled(["finance"], "legal", ["platform_admin"])).toBe(true);
    });

    it("regular tenant_admin does NOT bypass module gating", () => {
      expect(isModuleEnabled(["finance"], "procurement", ["tenant_admin"])).toBe(false);
      expect(isModuleEnabled([], "finance", ["tenant_admin"])).toBe(false);
    });

    it("no roles defaults to normal gating", () => {
      expect(isModuleEnabled(["finance"], "procurement")).toBe(false);
      expect(isModuleEnabled(["finance"], "procurement", undefined)).toBe(false);
    });

    it("super_admin sees all even when enabled list is empty", () => {
      expect(isModuleEnabled([], "hrms", ["super_admin"])).toBe(true);
      expect(isModuleEnabled([], "legal", ["super_admin"])).toBe(true);
      expect(isModuleEnabled([], "audit", ["super_admin"])).toBe(true);
    });
  });
});
