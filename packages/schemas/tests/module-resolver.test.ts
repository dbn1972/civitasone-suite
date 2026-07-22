import { describe, it, expect } from "vitest";
import {
  MODULE_MANIFEST,
  type ModuleDef,
} from "../src/module-manifest.js";
import {
  resolveModules,
  validateModuleSet,
  previewDependencies,
} from "../src/module-resolver.js";

describe("Module Manifest", () => {
  it("contains all expected foundation modules", () => {
    const foundation = MODULE_MANIFEST.filter((m) => m.foundation);
    const foundationIds = foundation.map((m) => m.id).sort();
    expect(foundationIds).toEqual([
      "admin",
      "audit",
      "gateway",
      "identity",
      "install",
      "notification",
      "policy",
      "queue",
      "tenant",
      "workflow",
    ]);
  });

  it("has unique module IDs", () => {
    const ids = MODULE_MANIFEST.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all dependencies reference valid modules", () => {
    const validIds = new Set(MODULE_MANIFEST.map((m) => m.id));
    for (const mod of MODULE_MANIFEST) {
      for (const dep of mod.requires) {
        const moduleId = dep.split(":")[0]!;
        expect(validIds.has(moduleId)).toBe(true);
      }
    }
  });

  it("sub-module dependencies reference valid sub-modules", () => {
    const subModuleMap = new Map<string, Set<string>>();
    for (const mod of MODULE_MANIFEST) {
      if (mod.subModules) {
        subModuleMap.set(mod.id, new Set(mod.subModules.map((s) => s.id)));
      }
    }

    for (const mod of MODULE_MANIFEST) {
      for (const dep of mod.requires) {
        if (dep.includes(":")) {
          const [moduleId, subModuleId] = dep.split(":");
          const subs = subModuleMap.get(moduleId!);
          expect(subs).toBeDefined();
          expect(subs!.has(subModuleId!)).toBe(true);
        }
      }
    }
  });
});

describe("resolveModules", () => {
  it("always includes foundation modules even with empty selection", () => {
    const result = resolveModules([]);
    expect(result.foundation).toEqual([
      "admin",
      "audit",
      "gateway",
      "identity",
      "install",
      "notification",
      "policy",
      "queue",
      "tenant",
      "workflow",
    ]);
    for (const f of result.foundation) {
      expect(result.enabledModules).toContain(f);
    }
  });

  it("resolving payroll auto-adds hrms and finance", () => {
    const result = resolveModules(["payroll"]);
    expect(result.enabledModules).toContain("payroll");
    expect(result.enabledModules).toContain("hrms");
    expect(result.enabledModules).toContain("finance");

    // Should have auto-enabled entries for hrms and finance
    const autoIds = result.autoEnabled.map((a) => a.module);
    expect(autoIds).toContain("hrms");
    expect(autoIds).toContain("finance");
  });

  it("resolving payroll marks hrms and finance as thin mode", () => {
    const result = resolveModules(["payroll"]);
    const hrmsEntry = result.autoEnabled.find((a) => a.module === "hrms");
    const financeEntry = result.autoEnabled.find((a) => a.module === "finance");
    expect(hrmsEntry).toBeDefined();
    expect(hrmsEntry!.mode).toBe("thin");
    expect(financeEntry).toBeDefined();
    expect(financeEntry!.mode).toBe("thin");
  });

  it("resolving payroll with hrms explicitly selected marks hrms as full", () => {
    const result = resolveModules(["payroll", "hrms"]);
    // hrms was explicitly selected, so it should NOT appear in autoEnabled
    const autoIds = result.autoEnabled.map((a) => a.module);
    expect(autoIds).not.toContain("hrms");
    // finance should still be auto-enabled as thin
    expect(autoIds).toContain("finance");
  });

  it("resolving procurement auto-adds finance", () => {
    const result = resolveModules(["procurement"]);
    expect(result.enabledModules).toContain("procurement");
    expect(result.enabledModules).toContain("finance");
    const financeEntry = result.autoEnabled.find((a) => a.module === "finance");
    expect(financeEntry).toBeDefined();
    expect(financeEntry!.mode).toBe("thin");
  });

  it("resolving asset auto-adds finance and procurement (and procurement's deps transitively)", () => {
    const result = resolveModules(["asset"]);
    expect(result.enabledModules).toContain("asset");
    expect(result.enabledModules).toContain("finance");
    expect(result.enabledModules).toContain("procurement");

    // procurement was auto-added because asset requires it
    const procEntry = result.autoEnabled.find((a) => a.module === "procurement");
    expect(procEntry).toBeDefined();
    expect(procEntry!.mode).toBe("full"); // full module dependency, not sub-module
  });

  it("resolving with an already-complete set is idempotent", () => {
    const firstRun = resolveModules(["payroll", "hrms", "finance"]);
    const secondRun = resolveModules(firstRun.enabledModules);

    expect(secondRun.enabledModules.sort()).toEqual(firstRun.enabledModules.sort());
    // When all modules are already selected, no new auto-enables needed
    // (foundation is always there, and user-selected covers everything)
  });

  it("is idempotent — running resolver output through resolver again yields same result", () => {
    const initial = resolveModules(["contract", "grant"]);
    const rerun = resolveModules(initial.enabledModules);
    expect(rerun.enabledModules.sort()).toEqual(initial.enabledModules.sort());
  });

  it("handles modules with no dependencies", () => {
    const result = resolveModules(["crm", "helpdesk"]);
    expect(result.enabledModules).toContain("crm");
    expect(result.enabledModules).toContain("helpdesk");
    expect(result.autoEnabled).toHaveLength(0);
  });

  it("resolves inventory → stock → procurement → finance transitively", () => {
    const result = resolveModules(["inventory"]);
    expect(result.enabledModules).toContain("inventory");
    expect(result.enabledModules).toContain("stock");
    expect(result.enabledModules).toContain("procurement");
    expect(result.enabledModules).toContain("finance");
  });

  it("resolves court → legal", () => {
    const result = resolveModules(["court"]);
    expect(result.enabledModules).toContain("court");
    expect(result.enabledModules).toContain("legal");
    const legalEntry = result.autoEnabled.find((a) => a.module === "legal");
    expect(legalEntry).toBeDefined();
    expect(legalEntry!.mode).toBe("full");
  });

  it("resolves grant → finance + citizen", () => {
    const result = resolveModules(["grant"]);
    expect(result.enabledModules).toContain("grant");
    expect(result.enabledModules).toContain("finance");
    expect(result.enabledModules).toContain("citizen");
  });

  it("resolves contract → finance + procurement (and procurement's finance deps)", () => {
    const result = resolveModules(["contract"]);
    expect(result.enabledModules).toContain("contract");
    expect(result.enabledModules).toContain("finance");
    expect(result.enabledModules).toContain("procurement");
  });

  it("resolves estab → hrms", () => {
    const result = resolveModules(["estab"]);
    expect(result.enabledModules).toContain("estab");
    expect(result.enabledModules).toContain("hrms");
  });

  it("does not include non-selected, non-dependency modules", () => {
    const result = resolveModules(["crm"]);
    expect(result.enabledModules).not.toContain("payroll");
    expect(result.enabledModules).not.toContain("hrms");
    expect(result.enabledModules).not.toContain("finance");
  });

  it("reports no warnings when there are no circular dependencies", () => {
    const result = resolveModules(["payroll"]);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("resolveModules — sub-module thin vs full mode", () => {
  it("dependency on sub-module makes parent thin when not explicitly selected", () => {
    // payroll depends on hrms:employees — hrms should be thin
    const result = resolveModules(["payroll"]);
    const hrmsEntry = result.autoEnabled.find((a) => a.module === "hrms");
    expect(hrmsEntry).toBeDefined();
    expect(hrmsEntry!.mode).toBe("thin");
  });

  it("explicitly selecting the parent module makes it full, not thin", () => {
    const result = resolveModules(["payroll", "hrms"]);
    // hrms is user-selected, so not in autoEnabled
    const hrmsAuto = result.autoEnabled.find((a) => a.module === "hrms");
    expect(hrmsAuto).toBeUndefined();
    expect(result.enabledModules).toContain("hrms");
  });

  it("full module dependency results in full mode for auto-enabled", () => {
    // asset requires "procurement" (full, not sub-module)
    const result = resolveModules(["asset"]);
    const procEntry = result.autoEnabled.find((a) => a.module === "procurement");
    expect(procEntry).toBeDefined();
    expect(procEntry!.mode).toBe("full");
  });
});

describe("validateModuleSet", () => {
  it("validates a complete module set as valid", () => {
    const result = validateModuleSet(["payroll", "hrms", "finance"]);
    expect(result.valid).toBe(true);
    expect(result.unmet).toHaveLength(0);
  });

  it("detects unmet dependencies", () => {
    const result = validateModuleSet(["payroll"]);
    expect(result.valid).toBe(false);
    expect(result.unmet.length).toBeGreaterThan(0);
    // payroll requires hrms:employees, hrms:attendance, finance:gl
    const missingModules = result.unmet.map((u) => u.missing);
    expect(missingModules).toContain("hrms:employees");
    expect(missingModules).toContain("hrms:attendance");
    expect(missingModules).toContain("finance:gl");
  });

  it("validates modules with no dependencies as valid", () => {
    const result = validateModuleSet(["crm", "helpdesk", "legal"]);
    expect(result.valid).toBe(true);
    expect(result.unmet).toHaveLength(0);
  });

  it("validates small_office plan (independent modules)", () => {
    // Small office: finance, hrms, citizen, report, analytics, helpdesk
    const result = validateModuleSet([
      "finance",
      "hrms",
      "citizen",
      "report",
      "analytics",
      "helpdesk",
    ]);
    expect(result.valid).toBe(true);
  });

  it("validates psu plan", () => {
    // PSU edition: finance, hrms, payroll, procurement, contract, asset, stock, project, analytics, report, helpdesk, crm
    const result = validateModuleSet([
      "finance",
      "hrms",
      "payroll",
      "procurement",
      "contract",
      "asset",
      "stock",
      "project",
      "analytics",
      "report",
      "helpdesk",
      "crm",
    ]);
    expect(result.valid).toBe(true);
  });

  it("validates govt plan", () => {
    // Government edition: all core + domain modules
    const result = validateModuleSet([
      "finance",
      "hrms",
      "payroll",
      "procurement",
      "contract",
      "asset",
      "stock",
      "inventory",
      "estab",
      "citizen",
      "legal",
      "court",
      "grant",
      "project",
      "meeting",
      "analytics",
      "report",
      "knowledge",
      "location",
    ]);
    expect(result.valid).toBe(true);
  });

  it("detects missing transitive dependency", () => {
    // inventory → stock → procurement → finance, missing stock
    const result = validateModuleSet(["inventory", "procurement", "finance"]);
    expect(result.valid).toBe(false);
    const missing = result.unmet.find((u) => u.module === "inventory");
    expect(missing).toBeDefined();
    expect(missing!.missing).toBe("stock");
  });

  it("foundation modules are implicitly included in validation", () => {
    // Foundation is always there, so modules depending on nothing should validate
    const result = validateModuleSet(["finance"]);
    expect(result.valid).toBe(true);
  });
});

describe("previewDependencies", () => {
  it("returns empty array for module with no dependencies", () => {
    const preview = previewDependencies("crm");
    expect(preview).toHaveLength(0);
  });

  it("returns direct dependencies for payroll", () => {
    const preview = previewDependencies("payroll");
    const modules = preview.map((p) => p.module);
    expect(modules).toContain("hrms");
    expect(modules).toContain("finance");
  });

  it("marks sub-module dependencies as thin mode", () => {
    const preview = previewDependencies("payroll");
    const hrmsEntry = preview.find((p) => p.module === "hrms");
    expect(hrmsEntry).toBeDefined();
    expect(hrmsEntry!.mode).toBe("thin");
  });

  it("marks full module dependencies as full mode", () => {
    const preview = previewDependencies("asset");
    const procEntry = preview.find((p) => p.module === "procurement");
    expect(procEntry).toBeDefined();
    expect(procEntry!.mode).toBe("full");
  });

  it("includes transitive dependencies", () => {
    const preview = previewDependencies("inventory");
    const modules = preview.map((p) => p.module);
    expect(modules).toContain("stock");
    expect(modules).toContain("procurement");
    expect(modules).toContain("finance");
  });

  it("returns empty array for unknown module", () => {
    const preview = previewDependencies("nonexistent");
    expect(preview).toHaveLength(0);
  });

  it("returns correct tree for contract (direct + transitive)", () => {
    const preview = previewDependencies("contract");
    const modules = preview.map((p) => p.module);
    // contract requires finance:bills and procurement
    // procurement requires finance:budgets and finance:bills
    expect(modules).toContain("finance");
    expect(modules).toContain("procurement");
  });

  it("does not include the module itself in the preview", () => {
    const preview = previewDependencies("payroll");
    const modules = preview.map((p) => p.module);
    expect(modules).not.toContain("payroll");
  });
});

describe("resolveModules — cycle detection", () => {
  it("reports no cycles in the default manifest", () => {
    const result = resolveModules(["payroll"]);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("resolveModules — edge cases", () => {
  it("handles empty selection gracefully", () => {
    const result = resolveModules([]);
    // Only foundation modules should be enabled
    expect(result.enabledModules.sort()).toEqual(result.foundation.sort());
    expect(result.autoEnabled).toHaveLength(0);
  });

  it("handles duplicate selections", () => {
    const result = resolveModules(["crm", "crm", "crm"]);
    expect(result.enabledModules.filter((m) => m === "crm")).toHaveLength(1);
  });

  it("handles unknown module IDs gracefully", () => {
    const result = resolveModules(["nonexistent"]);
    // Should still include foundation + the unknown module in the set
    expect(result.enabledModules).toContain("nonexistent");
    // No auto-enabled since module has no definition with requires
    expect(result.autoEnabled).toHaveLength(0);
  });

  it("selecting a sub-module parent directly (finance:gl) treats it as selecting finance", () => {
    const result = resolveModules(["finance:gl"]);
    // The parser extracts "finance" as the module ID
    expect(result.enabledModules).toContain("finance");
  });
});
