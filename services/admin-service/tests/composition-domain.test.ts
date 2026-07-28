/**
 * Pure dependency-resolver tests (no DB) — the composability contract:
 * enabling auto-pulls hard deps, disabling is blocked by dependents, deps GC,
 * core is immovable, and the graph is validated (unknown deps / cycles).
 */
import { describe, it, expect } from "vitest";
import {
  buildRegistry,
  resolveComposition,
  applyEnable,
  applyDisable,
  canDisable,
  coreIds,
  hardClosure,
  CompositionError,
  type ModuleDef,
} from "../src/modules/composition/domain.js";

// Mirror of the seeded production graph (subset of columns the resolver uses).
function fixtureDefs(): ModuleDef[] {
  const m = (id: string, layer: number, isCore: boolean, hardDeps: string[], softDeps: string[], screens: string[], sortOrder: number): ModuleDef => ({
    id, name: id, layer, isCore, hardDeps, softDeps, screens, cluster: "", sortOrder,
  });
  return [
    m("identity", 0, true, [], [], ["Users"], 10),
    m("org", 0, true, ["identity"], [], ["Org tree"], 20),
    m("config", 0, true, ["identity"], [], ["Entities"], 30),
    m("workflow", 0, true, ["identity"], [], ["Approvals"], 40),
    m("audit", 0, true, ["identity"], [], ["Audit log"], 50),
    m("employee", 1, false, ["org", "config"], [], ["Employee Master", "e-Service Book"], 60),
    m("attendance", 2, false, ["employee"], [], ["Attendance"], 70),
    m("leave", 2, false, ["employee", "workflow", "config"], ["attendance"], ["Leave"], 80),
    m("recruitment", 2, false, ["org"], ["employee"], ["Manpower"], 90),
    m("appraisal", 2, false, ["employee", "workflow"], [], ["Appraisal"], 100),
    m("career", 2, false, ["employee", "workflow"], [], ["Transfers"], 110),
    m("finance", 3, false, ["config"], [], ["General Ledger"], 120),
    m("budget", 3, false, ["finance"], [], ["Budget"], 200),
    m("procurement", 3, false, ["finance", "budget", "workflow"], [], ["Tender"], 230),
    m("payroll", 3, false, ["employee", "config", "finance"], ["attendance", "leave", "loans"], ["Payroll & Salary Slip"], 130),
    m("loans", 3, false, ["employee"], ["payroll"], ["Loans & Advances"], 140),
    m("separation", 3, false, ["employee"], ["payroll"], ["Separation"], 160),
    m("ess", 4, false, ["employee"], [], ["ESS"], 170),
  ];
}
const reg = buildRegistry(fixtureDefs());
const CORE = new Set(coreIds(reg));

describe("buildRegistry validation", () => {
  it("rejects duplicate ids", () => {
    const dup = [...fixtureDefs(), fixtureDefs()[0]];
    expect(() => buildRegistry(dup)).toThrow(CompositionError);
  });
  it("rejects unknown dependency references", () => {
    const bad = fixtureDefs();
    bad.push({ id: "ghost", name: "ghost", layer: 5, isCore: false, hardDeps: ["nope"], softDeps: [], screens: [], cluster: "", sortOrder: 999 });
    expect(() => buildRegistry(bad)).toThrow(/unknown dependency/);
  });
  it("detects a hard-dependency cycle", () => {
    const cyc: ModuleDef[] = [
      { id: "a", name: "a", layer: 0, isCore: false, hardDeps: ["b"], softDeps: [], screens: [], cluster: "", sortOrder: 1 },
      { id: "b", name: "b", layer: 0, isCore: false, hardDeps: ["a"], softDeps: [], screens: [], cluster: "", sortOrder: 2 },
    ];
    expect(() => buildRegistry(cyc)).toThrow(/cycle/);
  });
});

describe("resolveComposition", () => {
  it("core-only when no user modules", () => {
    const c = resolveComposition(reg, []);
    expect(c.entries.every((e) => e.source === "core")).toBe(true);
    expect(new Set(c.moduleIds)).toEqual(CORE);
  });

  it("HRIS-only: just employee pulls no non-core deps", () => {
    const c = resolveComposition(reg, ["employee"]);
    const bySource = Object.fromEntries(c.entries.map((e) => [e.id, e.source]));
    expect(bySource["employee"]).toBe("user");
    // employee's hard deps (org, config) are already core → no 'dep' rows
    expect(c.entries.filter((e) => e.source === "dep")).toHaveLength(0);
  });

  it("Payroll-only pulls employee + finance as deps (not full HRMS)", () => {
    const c = resolveComposition(reg, ["payroll"]);
    const bySource = Object.fromEntries(c.entries.map((e) => [e.id, e.source]));
    expect(bySource["payroll"]).toBe("user");
    expect(bySource["employee"]).toBe("dep");
    expect(bySource["finance"]).toBe("dep");
    // soft deps (attendance, leave, loans) must NOT be auto-enabled
    expect(bySource["attendance"]).toBeUndefined();
    expect(bySource["leave"]).toBeUndefined();
    expect(bySource["loans"]).toBeUndefined();
  });

  it("aggregates screens across enabled modules, in layer order", () => {
    const c = resolveComposition(reg, ["payroll"]);
    expect(c.screens).toContain("Payroll & Salary Slip");
    expect(c.screens).toContain("Employee Master");
    // identity (layer 0) sorts before payroll (layer 3)
    expect(c.screens.indexOf("Users")).toBeLessThan(c.screens.indexOf("Payroll & Salary Slip"));
  });

  it("throws on unknown user module", () => {
    expect(() => resolveComposition(reg, ["nope"])).toThrow(CompositionError);
  });
});

describe("canDisable / applyDisable", () => {
  it("blocks disabling employee while payroll is enabled", () => {
    const res = canDisable(reg, ["payroll", "employee"], "employee");
    expect(res.ok).toBe(false);
    expect(res.blockers).toContain("payroll");
    expect(() => applyDisable(reg, ["payroll", "employee"], "employee")).toThrow(/cannot disable/);
  });

  it("allows disabling employee when nothing depends on it", () => {
    const res = canDisable(reg, ["employee"], "employee");
    expect(res.ok).toBe(true);
    expect(applyDisable(reg, ["employee"], "employee")).toEqual([]);
  });

  it("never allows disabling a core module", () => {
    const res = canDisable(reg, ["employee"], "config");
    expect(res.ok).toBe(false);
    expect(res.blockers).toEqual(["__core__"]);
  });

  it("disabling payroll auto-GCs its dep-only finance", () => {
    // payroll enabled → finance is a dep. Remove payroll → finance no longer resolved.
    const afterUser = applyDisable(reg, ["payroll"], "payroll");
    const c = resolveComposition(reg, afterUser);
    expect(c.moduleIds).not.toContain("finance");
    expect(c.moduleIds).not.toContain("payroll");
  });
});

describe("applyEnable", () => {
  it("is idempotent and drops implicit core", () => {
    expect(applyEnable(reg, ["payroll"], "payroll")).toEqual(["payroll"]);
    // enabling a core module is a no-op (core is implicit, never stored as user)
    expect(applyEnable(reg, ["payroll"], "config")).toEqual(["payroll"]);
  });
  it("adds a new module to the user set", () => {
    expect(applyEnable(reg, ["employee"], "leave").sort()).toEqual(["employee", "leave"]);
  });
});

describe("hardClosure", () => {
  it("is transitive", () => {
    // payroll -> employee -> {org, config}; employee,finance -> config -> identity
    const cl = hardClosure(reg, ["payroll"]);
    ["employee", "config", "finance", "org", "identity"].forEach((d) => expect(cl.has(d)).toBe(true));
  });
});

describe("ERP (non-HR) dependency edges", () => {
  it("enabling procurement pulls finance + budget as deps (workflow is core)", () => {
    const c = resolveComposition(reg, ["procurement"]);
    const src = Object.fromEntries(c.entries.map((e) => [e.id, e.source]));
    expect(src["procurement"]).toBe("user");
    expect(src["finance"]).toBe("dep");
    expect(src["budget"]).toBe("dep");
    expect(src["workflow"]).toBe("core");
  });

  it("blocks disabling finance while procurement is enabled", () => {
    const res = canDisable(reg, ["procurement", "finance"], "finance");
    expect(res.ok).toBe(false);
    expect(res.blockers).toContain("procurement");
  });

  it("disabling procurement GCs its dep-only budget + finance", () => {
    const afterUser = applyDisable(reg, ["procurement"], "procurement");
    const c = resolveComposition(reg, afterUser);
    expect(c.moduleIds).not.toContain("procurement");
    expect(c.moduleIds).not.toContain("budget");
    expect(c.moduleIds).not.toContain("finance");
  });
});
