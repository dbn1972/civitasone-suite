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

  // ── ST-M01-04b — HRMS sub-route key split, web nav/ModuleGate side ─────────
  // M01 exit criterion 3 ("no payroll/leave/recruitment APIs or SCREENS
  // reachable" for the standalone SKU). The web nav/ModuleGate reads the SAME
  // composition projection the gateway reads (apps/web .../moduleVisibility.ts →
  // /v1/admin/composition/my-modules → toGatewayKeys). After the split that
  // projection, for a smarttransfer_standalone tenant, is
  // {workforce_core, smarttransfer, workflow} — it NO LONGER contains the coarse
  // `hrms` key nor any `hrms-<module>` sub-key, so the leave / attendance /
  // recruitment / payroll-facing screens (gated on those sub-keys) are hidden,
  // while the Workforce Core screens (gated on `workforce_core`) stay visible.
  describe("standalone SKU hides non-core HRMS screens (ST-M01-04b)", () => {
    // The exact gateway-key projection admin-service emits for the standalone
    // profile after the split (verified by the admin + cross-service-live tests).
    const standaloneKeys = ["workforce_core", "smarttransfer", "workflow"];

    it("HIDES the payroll, leave, recruitment and attendance screens", () => {
      for (const screenKey of [
        "payroll",
        "hrms-payroll",
        "hrms-leave",
        "hrms-recruitment",
        "hrms-attendance",
        "hrms-appraisal",
      ]) {
        expect(
          isModuleEnabled(standaloneKeys, screenKey, ["employee"]),
          `standalone nav must HIDE ${screenKey}`,
        ).toBe(false);
      }
    });

    it("SHOWS the Workforce Core and SmartTransfer screens + platform", () => {
      expect(isModuleEnabled(standaloneKeys, "workforce_core", ["employee"])).toBe(true);
      expect(isModuleEnabled(standaloneKeys, "smarttransfer", ["employee"])).toBe(true);
      // platform always visible
      expect(isModuleEnabled(standaloneKeys, "documents", ["employee"])).toBe(true);
      expect(isModuleEnabled(standaloneKeys, "workflow", ["employee"])).toBe(true);
    });

    it("a full-HRMS tenant SHOWS the split screens (no regression)", () => {
      // A full-HRMS projection carries workforce_core + every sub-key.
      const fullHrmsKeys = [
        "workforce_core",
        "hrms-leave",
        "hrms-attendance",
        "hrms-recruitment",
        "hrms-appraisal",
        "hrms-payroll",
        "hrms-self-service",
        "payroll",
      ];
      for (const screenKey of ["hrms-leave", "hrms-recruitment", "hrms-payroll", "payroll", "workforce_core"]) {
        expect(isModuleEnabled(fullHrmsKeys, screenKey, ["employee"]), `full-HRMS must SHOW ${screenKey}`).toBe(true);
      }
    });

    it("super_admin still bypasses (sees the non-core screens even on a standalone tenant)", () => {
      expect(isModuleEnabled(standaloneKeys, "hrms-leave", ["super_admin"])).toBe(true);
    });
  });
});
