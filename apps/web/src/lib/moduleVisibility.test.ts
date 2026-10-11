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

  // ST-M01-02: platform module keys are always visible, mirroring the gateway
  // PLATFORM_ROUTES, so a composed/standalone tenant whose projection omits a
  // platform key (e.g. documents) is never blocked from a platform screen.
  describe("platform modules are always visible (ST-M01-02)", () => {
    it("shows documents/eoffice even when NOT in a non-empty enabled list", () => {
      // A standalone tenant has a real, non-empty list that omits documents.
      const standalone = ["smarttransfer", "workflow"];
      expect(isModuleEnabled(standalone, "documents")).toBe(true);
      expect(isModuleEnabled(standalone, "eoffice")).toBe(true);
    });

    it("shows notification/workflow/audit/identity/admin regardless of the list", () => {
      for (const key of ["notification", "workflow", "audit", "identity", "admin"]) {
        expect(isModuleEnabled(["finance"], key)).toBe(true);
      }
    });

    it("still hides a genuinely non-platform disabled module", () => {
      // Guard against over-broad platform matching: payroll is NOT platform.
      expect(isModuleEnabled(["smarttransfer", "workflow"], "payroll")).toBe(false);
    });
  });
});
