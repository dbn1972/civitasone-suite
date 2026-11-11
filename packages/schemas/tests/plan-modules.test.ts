import { describe, it, expect } from "vitest";
import { resolvePlanModules, PlanModuleError } from "../src/plan-modules.js";
import { MODULE_CATALOGUE, CATALOGUE_BY_ID } from "../src/module-catalogue.js";

describe("M6 plan -> catalogue modules", () => {
  it("explicit catalogue_modules are closed over hard dependencies, core modules excluded", () => {
    const r = resolvePlanModules({ catalogueModules: ["payroll"], enabledModules: [] });
    expect(r.source).toBe("catalogue_modules");
    expect(r.selected).toEqual(["payroll"]);
    // payroll hard-depends on employee + config(core); employee on org(core) + config(core)
    expect(r.pulledIn).toEqual(["employee"]);
    expect(r.moduleIds).toEqual(["employee", "payroll"]);
    expect(r.coreModules).toContain("config");
    expect(r.moduleIds.every((id) => !CATALOGUE_BY_ID.get(id)!.isCore)).toBe(true);
  });

  it("procurement pulls finance, budget (and workflow is core)", () => {
    const r = resolvePlanModules({ catalogueModules: ["procurement"], enabledModules: [] });
    expect(r.moduleIds).toEqual(expect.arrayContaining(["procurement", "finance", "budget"]));
    expect(r.pulledIn).toEqual(expect.arrayContaining(["finance", "budget"]));
  });

  it("a plan can be HRMS without Recruitment: the closure never adds Recruitment", () => {
    const hr = ["employee", "attendance", "leave", "appraisal", "career", "ess"];
    const r = resolvePlanModules({ catalogueModules: hr, enabledModules: ["hrms"] });
    expect(r.moduleIds).not.toContain("recruitment");
    expect(r.moduleIds).toEqual(expect.arrayContaining(hr));
  });

  it("legacy plans (enabled_modules product ids, no catalogue_modules) keep their meaning: hrms = the whole HR cluster", () => {
    const r = resolvePlanModules({ catalogueModules: null, enabledModules: ["hrms", "payroll", "finance"] });
    expect(r.source).toBe("enabled_modules");
    expect(r.moduleIds).toEqual(expect.arrayContaining(["employee", "attendance", "leave", "recruitment", "appraisal", "career", "ess", "payroll", "loans", "benefits", "separation", "finance", "budget", "treasury"]));
  });

  it("every product id in a stored plan resolves; manifest-only products (theme, ml) are ignored; junk is refused", () => {
    expect(resolvePlanModules({ enabledModules: ["finance", "theme", "ml"] }).moduleIds).toEqual(["finance", "budget", "treasury"]);
    expect(() => resolvePlanModules({ enabledModules: ["nonsense"] })).toThrow(PlanModuleError);
    expect(() => resolvePlanModules({ catalogueModules: ["nonsense"], enabledModules: [] })).toThrow(/unknown catalogue module/);
  });

  it("resolution is deterministic, deduped and in catalogue order", () => {
    const a = resolvePlanModules({ catalogueModules: ["payroll", "employee", "payroll"], enabledModules: [] });
    const b = resolvePlanModules({ catalogueModules: ["employee", "payroll"], enabledModules: [] });
    expect(a).toEqual(b);
    const order = MODULE_CATALOGUE.map((m) => m.id);
    expect(a.moduleIds.map((id) => order.indexOf(id))).toEqual([...a.moduleIds.map((id) => order.indexOf(id))].sort((x, y) => x - y));
  });

  it("naming only core modules gives an empty tenant set (nothing to sell)", () => {
    const r = resolvePlanModules({ catalogueModules: ["identity", "org"], enabledModules: [] });
    expect(r.moduleIds).toEqual([]);
  });
});
