/**
 * Tenant-profile B2 — the govt_small_office module bundle (admin migration 0064). PURE (no DB): the bundle is read from
 * the migration text and checked against the module catalogue, the composition resolver and gateway-map.
 * Source of the module set: docs/design/TENANT-PROFILE-SWITCH.md section 5 "Bundle" table (17 chosen, 22 effective).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { MODULE_CATALOGUE } from "@civitasone/schemas/module-catalogue";
import { PROFILES, composesOnOnboard, getProfile } from "@civitasone/tenant-profile";

const { buildRegistry, resolveComposition } = await import("../src/modules/composition/domain.js");
const { toGatewayKeys } = await import("../src/modules/composition/gateway-map.js");
import type { ModuleDef } from "../src/modules/composition/domain.js";

const SQL = readFileSync(new URL("../migrations/0064_govt_small_office_bundle.sql", import.meta.url), "utf8");
const EXPECTED = [
  "employee", "attendance", "leave", "appraisal", "ess",
  "payroll", "loans", "benefits", "separation",
  "finance", "budget", "treasury",
  "procurement", "inventory", "asset",
  "legal", "analytics",
];
const EXCLUDED = [
  "recruitment", "career", "workforce_core", "smarttransfer", "revenue", "contract", "works", "project", "grant", "citizen",
  "crm", "helpdesk", "knowledge", "inspection", "telephony", "meeting", "court", "visitor", "billing", "field",
];

function migrationModules(): string[] {
  const m = /ARRAY\[([^\]]+)\]/.exec(SQL);
  expect(m, "default_modules ARRAY in 0064").not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]!);
}
const defs: ModuleDef[] = MODULE_CATALOGUE.map((c) => ({
  id: c.id, name: c.name, layer: c.layer, isCore: c.isCore, hardDeps: [...c.hardDeps], softDeps: [...c.softDeps],
  screens: [...c.screens], cluster: c.cluster, sortOrder: c.sortOrder,
}));

describe("migration 0064 govt_small_office bundle", () => {
  it("lists exactly the 17 design modules, no duplicates, none of the excluded ones", () => {
    const ids = migrationModules();
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(17);
    expect([...ids].sort()).toEqual([...EXPECTED].sort());
    for (const x of EXCLUDED) expect(ids).not.toContain(x);
  });
  it("every module exists in the catalogue and is non-core", () => {
    const byId = new Map(MODULE_CATALOGUE.map((m) => [m.id, m]));
    for (const id of migrationModules()) {
      expect(byId.has(id), id).toBe(true);
      expect(byId.get(id)!.isCore, id).toBe(false);
    }
  });
  it("all hard-deps resolve inside the set + core: 5 core + 17 = 22 effective, nothing auto-pulled", () => {
    const reg = buildRegistry(defs);
    const c = resolveComposition(reg, migrationModules());
    expect(c.moduleIds).toHaveLength(22);
    expect(c.entries.filter((e) => e.source === "dep")).toEqual([]);
    expect(c.entries.filter((e) => e.source === "core")).toHaveLength(5);
  });
  it("is additive and idempotent: only INSERT ... ON CONFLICT DO NOTHING, derived from govt_dept, bundle derived from profile", () => {
    const code = SQL.replace(/^--.*$/gm, "");
    expect(code).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    expect(code).not.toMatch(/finance_major_heads/i);
    expect(code.match(/ON CONFLICT \(code\) DO NOTHING/g)).toHaveLength(2);
    expect(code).toMatch(/FROM composition\.org_profile g\s+WHERE g\.code = 'govt_dept'/);
    expect(code).toMatch(/p\.default_modules[\s\S]*FROM composition\.org_profile p[\s\S]*p\.code = 'govt_small_office'/);
  });
});

describe("gateway-map covers every govt_small_office bundle module", () => {
  it("each module projects to at least one gateway route-key", () => {
    for (const id of migrationModules()) expect(toGatewayKeys([id]).length, id).toBeGreaterThan(0);
  });
  it("the bundle's gateway keys are a subset of the catalogue gatewayKeys for those modules", () => {
    const allowed = new Set(MODULE_CATALOGUE.filter((m) => migrationModules().includes(m.id)).flatMap((m) => [...m.gatewayKeys]));
    for (const k of toGatewayKeys(migrationModules())) expect(allowed.has(k), k).toBe(true);
  });
});

describe("catalogue wiring (data-keyed)", () => {
  it("govt_small_office composes on onboard via catalogue data with bundleCode matching the migration", () => {
    const p = getProfile("govt_small_office")!;
    expect(p.composeOnOnboard).toBe(true);
    expect(composesOnOnboard("govt_small_office")).toBe(true);
    expect(p.bundleCode).toBe("govt_small_office");
    expect(SQL).toContain(`'${p.bundleCode}'`);
  });
  it("other profiles unchanged: govt_dept off; psu, section8, small_office on; placeholders off", () => {
    const on = PROFILES.filter((x) => x.composeOnOnboard).map((x) => x.code).sort();
    expect(on).toEqual(["govt_small_office", "psu", "section8", "small_office"]);
    expect(composesOnOnboard("govt_dept")).toBe(false);
  });
});
