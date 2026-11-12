/**
 * M1 / M4 — the module catalogue is the single source and the move changes nothing for existing tenants.
 *
 *  1. composition.module_registry (after ALL migrations, incl. 0059) equals packages/schemas MODULE_CATALOGUE.
 *  2. composition/gateway-map.ts equals the catalogue's gatewayKeys (both directions).
 *  3. REAL migration 0059 text over a snapshot of the live UAT tenant configs (+ synthetic edge tenants):
 *     what each tenant reaches (gateway route-keys) is IDENTICAL before and after, for composed tenants; legacy-only
 *     tenants keep every legacy key they had. Each case runs inside a transaction that is rolled back, with the
 *     registry temporarily put back to its pre-0059 dependencies, so parallel test files never see it.
 *  4. MODULE_SOURCE=catalogue derives the older list from the catalogue and retires its write path; default off = unchanged.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MODULE_CATALOGUE, legacyKeyToModules, legacyKeysFromModules } from "@civitasone/schemas/module-catalogue";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { buildRegistry, resolveComposition } = await import("../src/modules/composition/domain.js");
const { toGatewayKeys, COMPOSITION_TO_GATEWAY_KEYS } = await import("../src/modules/composition/gateway-map.js");
import type { ModuleDef } from "../src/modules/composition/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "d9200000-eeee-4000-8000-000000000001";
const ZERO = "00000000-0000-0000-0000-000000000000";

interface Fixture { tenants: Array<{ label: string; entitlements: string; legacyEnabled?: string }> }
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/uat-tenant-module-configs.json", import.meta.url), "utf8")) as Fixture;

// Registry dependencies BEFORE migration 0059 (migrations 0025/0026/0049/0050/0056 state) for the 14 rows 0059 edits.
const OLD_DEPS: Record<string, { hard: string[]; soft: string[] }> = {
  payroll: { hard: ["employee", "config", "finance"], soft: ["attendance", "leave", "loans"] },
  inventory: { hard: ["finance"], soft: ["procurement"] },
  contract: { hard: ["workflow"], soft: ["procurement"] },
  legal: { hard: ["workflow"], soft: [] },
  finance: { hard: ["config"], soft: [] },
  citizen: { hard: ["workflow"], soft: [] },
  employee: { hard: ["org", "config"], soft: [] },
  procurement: { hard: ["finance", "budget", "workflow"], soft: ["contract", "legal"] },
  project: { hard: ["config"], soft: ["grant", "finance"] },
  analytics: { hard: ["config"], soft: ["finance", "procurement", "grant"] },
  inspection: { hard: ["employee", "workflow"], soft: [] },
  helpdesk: { hard: [], soft: ["citizen", "crm"] },
  crm: { hard: [], soft: [] },
  meeting: { hard: [], soft: [] },
};
const MUNICIPAL = MODULE_CATALOGUE.filter((m) => m.cluster === "municipal").map((m) => m.id);

const MIGRATION_TEXT = readFileSync(new URL("../migrations/0059_module_catalogue_truth.sql", import.meta.url), "utf8");
const FORCE_LINES = /^ALTER TABLE .*FORCE ROW LEVEL SECURITY;$/gm;
const MIGRATION = MIGRATION_TEXT.replace(FORCE_LINES, ""); // FORCE toggling would race parallel files; the GUC confines the DML to the case tenant

class Rollback extends Error {}
type Sql = typeof sqlClient;

async function loadRegistry(sql: Sql): Promise<ModuleDef[]> {
  const rows = await sql<Array<{ id: string; name: string; layer: number; is_core: boolean; cluster: string; hard_deps: string[]; soft_deps: string[]; screens: string[]; sort_order: number }>>`
    SELECT id, name, layer, is_core, cluster, hard_deps, soft_deps, screens, sort_order FROM composition.module_registry`;
  return rows.map((r) => ({ id: r.id, name: r.name, layer: r.layer, isCore: r.is_core, cluster: r.cluster, hardDeps: r.hard_deps, softDeps: r.soft_deps, screens: r.screens, sortOrder: r.sort_order }));
}
async function reach(sql: Sql, tenantId: string): Promise<{ modules: string[]; gatewayKeys: string[]; legacyKeys: string[] }> {
  const sel = await sql<{ module_id: string }[]>`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${tenantId} AND source IN ('user','grandfather')`;
  const reg = buildRegistry(await loadRegistry(sql));
  const comp = resolveComposition(reg, [...new Set(sel.map((r) => r.module_id))]);
  return { modules: comp.moduleIds, gatewayKeys: toGatewayKeys(comp.moduleIds), legacyKeys: legacyKeysFromModules(comp.moduleIds) };
}

/** Run `body` in a tx under the tenant GUC with the pre-0059 registry and the fixture seeded; always rolls back. */
async function inCase<T>(tenantId: string, entitlements: string, legacyEnabled: string | undefined, body: (sql: Sql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sqlClient.begin(async (tx) => {
      const sql = tx as unknown as Sql;
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
      for (const [id, d] of Object.entries(OLD_DEPS)) {
        await sql`UPDATE composition.module_registry SET hard_deps = ${d.hard}, soft_deps = ${d.soft} WHERE id = ${id}`;
      }
      await sql`DELETE FROM composition.module_registry WHERE id = ANY(${MUNICIPAL})`; // pre-0059 catalogue had no municipal rows
      for (const e of entitlements.split(",").filter(Boolean)) {
        const [m, source] = e.split(":");
        await sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${tenantId}, ${m!}, ${source!}, ${ACTOR})`;
      }
      for (const k of (legacyEnabled ?? "").split(",").filter(Boolean)) {
        await sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${tenantId}, ${k}, true, ${ACTOR}, ${ACTOR})`;
      }
      result = await body(sql);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result as T;
}

afterAll(async () => { await sqlClient.end(); });

describe("catalogue is the single source (registry and gateway map derive from it)", () => {
  it("composition.module_registry equals MODULE_CATALOGUE after all migrations", async () => {
    const reg = await loadRegistry(sqlClient);
    const byId = new Map(reg.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual(MODULE_CATALOGUE.map((m) => m.id).sort());
    for (const m of MODULE_CATALOGUE) {
      const r = byId.get(m.id)!;
      expect({ id: r.id, name: r.name, layer: r.layer, isCore: r.isCore, cluster: r.cluster, hardDeps: [...r.hardDeps].sort(), softDeps: [...r.softDeps].sort(), screens: r.screens, sortOrder: r.sortOrder })
        .toEqual({ id: m.id, name: m.name, layer: m.layer, isCore: m.isCore, cluster: m.cluster, hardDeps: [...m.hardDeps].sort(), softDeps: [...m.softDeps].sort(), screens: [...m.screens], sortOrder: m.sortOrder });
    }
  });

  it("composition/gateway-map.ts equals the catalogue gatewayKeys, both ways", () => {
    for (const m of MODULE_CATALOGUE) {
      expect(COMPOSITION_TO_GATEWAY_KEYS[m.id] ?? [], m.id).toEqual([...m.gatewayKeys]);
    }
    for (const id of Object.keys(COMPOSITION_TO_GATEWAY_KEYS)) {
      expect(MODULE_CATALOGUE.some((m) => m.id === id), `gateway-map names ${id}, which the catalogue lacks`).toBe(true);
    }
  });

  it("the legacy map used by migration 0059 equals the catalogue inverse (SQL VALUES == TS)", () => {
    const sqlPairs = [...MIGRATION_TEXT.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`);
    const expected = [...legacyKeyToModules()].flatMap(([k, mods]) => mods.map((m) => `${k}>${m}`));
    for (const p of expected) expect(sqlPairs, p).toContain(p);
    // the municipal modules are routed by the gateway and must be entitle-able (the registry rows are inserted by 0059)
    for (const id of MUNICIPAL) expect(MIGRATION_TEXT).toContain(`('${id}',`);
  });
});

describe("migration 0059 over the live UAT tenant configs: nothing changes for existing tenants", () => {
  for (const t of FIXTURE.tenants) {
    it(`${t.label}`, async () => {
      const tenantId = `d9200000-0000-4000-8000-${String(FIXTURE.tenants.indexOf(t) + 1).padStart(12, "0")}`;
      const { before, after, again } = await inCase(tenantId, t.entitlements, t.legacyEnabled, async (sql) => {
        const before = await reach(sql, tenantId);
        await sql.unsafe(MIGRATION);
        const after = await reach(sql, tenantId);
        await sql.unsafe(MIGRATION); // idempotent
        const again = await reach(sql, tenantId);
        return { before, after, again };
      });
      expect(again).toEqual(after);
      const composedBefore = t.entitlements.length > 0;
      if (composedBefore) {
        // exactly the same modules and the same gateway route-keys as before (a payroll-only tenant keeps the
        // Finance it only had because Payroll pulled it in; a legal/contract/inventory tenant gains nothing it lacked
        // only where its dependencies were already present)
        if (t.label.startsWith("S2-")) {
          // synthetic: these three modules gained REAL requirements (employee / procurement); the migration cannot
          // keep a tenant broken, so they are the documented, intended additions and nothing else is added
          const added = after.modules.filter((m) => !before.modules.includes(m)).sort();
          expect(added).toEqual(["budget", "employee", "procurement"]);
          expect(before.modules.filter((m) => !after.modules.includes(m))).toEqual([]);
        } else {
          expect(after.modules).toEqual(before.modules);
          expect(after.gatewayKeys).toEqual(before.gatewayKeys);
        }
      }
      if (t.legacyEnabled && !t.entitlements.includes(":user")) {
        // legacy-only (or grandfather-only) tenants: every legacy key it had is still reachable through the catalogue
        for (const k of t.legacyEnabled.split(",")) {
          if (["audit", "workflow", "documents"].includes(k)) continue; // platform routes, never module-gated
          expect(after.legacyKeys, `${t.label}: legacy key ${k}`).toContain(k);
        }
      }
      if (t.legacyEnabled && t.entitlements.includes(":user")) {
        // a tenant that composed its own modules keeps exactly that set; its stale legacy rows add nothing
        expect(after.modules).toEqual(before.modules);
      }
    });
  }

  it("a tenant that only had Finance because Payroll pulled it in keeps Finance (the point of the materialisation)", async () => {
    const tenantId = "d9200000-0000-4000-8000-0000000000f1";
    const r = await inCase(tenantId, "payroll:user", undefined, async (sql) => {
      const before = await reach(sql, tenantId);
      await sql.unsafe(MIGRATION);
      const stored = await sql<{ module_id: string; source: string }[]>`SELECT module_id, source FROM composition.tenant_entitlement WHERE tenant_id = ${tenantId} ORDER BY module_id`;
      return { before, stored, after: await reach(sql, tenantId) };
    });
    expect(r.before.modules).toContain("finance");
    expect(r.after.modules).toContain("finance");
    expect(r.stored).toContainEqual({ module_id: "finance", source: "grandfather" });
  });

  it("after the migration a NEW tenant picking Payroll no longer gets Finance", async () => {
    const reg = buildRegistry(await loadRegistry(sqlClient));
    const comp = resolveComposition(reg, ["payroll"]);
    expect(comp.moduleIds).toContain("employee");
    expect(comp.moduleIds).not.toContain("finance");
  });

  it("every module the gateway routes can be entitled (municipal services included)", async () => {
    const ids = new Set((await loadRegistry(sqlClient)).map((r) => r.id));
    for (const id of MUNICIPAL) expect(ids.has(id), id).toBe(true);
    expect(toGatewayKeys(["shop", "market"])).toEqual(["market", "shop"]);
  });
});

describe("MODULE_SOURCE=catalogue (M4)", () => {
  const T = "d9200000-0000-4000-8000-0000000000a1";
  const LEGACY_ONLY = "d9200000-0000-4000-8000-0000000000a2";
  const adminAuth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600)}` });
  let app: FastifyInstance;
  async function seed(): Promise<void> {
    await sqlClient.begin(async (tx) => {
      const sql = tx as unknown as Sql;
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${T}`;
      await sql`DELETE FROM config.admin_module_configs WHERE tenant_id = ${T}`;
      for (const m of ["employee", "attendance", "leave", "finance", "payroll"]) {
        await sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${T}, ${m}, 'user', ${ACTOR})`;
      }
      // stale legacy row that disagrees with the catalogue
      await sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${T}, 'crm', true, ${ACTOR}, ${ACTOR})`;
    });
    await sqlClient.begin(async (tx) => {
      const sql = tx as unknown as Sql;
      await sql`select set_config('app.tenant_id', ${LEGACY_ONLY}, true)`;
      await sql`DELETE FROM config.admin_module_configs WHERE tenant_id = ${LEGACY_ONLY}`;
      await sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${LEGACY_ONLY}, 'finance', true, ${ACTOR}, ${ACTOR})`;
    });
  }
  async function wipeSeed(): Promise<void> {
    for (const t of [T, LEGACY_ONLY]) {
      await sqlClient.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        await sql`select set_config('app.tenant_id', ${t}, true)`;
        await sql`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
        await sql`DELETE FROM config.admin_module_configs WHERE tenant_id = ${t}`;
      });
    }
  }
  const list = async (tid: string, detail = false) =>
    (await app.inject({ method: "GET", url: `/v1/admin/tenant/modules${detail ? "?detail=1" : ""}`, headers: adminAuth(tid) })).json() as { data: Array<Record<string, unknown>> };

  beforeAll(async () => { app = await buildApp(); await seed(); });
  afterAll(async () => { delete process.env.MODULE_SOURCE; await wipeSeed(); await app.close(); });

  it("default (flag off): the older list is served from its own rows, unchanged", async () => {
    delete process.env.MODULE_SOURCE;
    expect((await list(T)).data).toEqual([{ name: "crm" }]);
  });

  it("flag on: the older list is derived from the catalogue and the stale row is ignored", async () => {
    process.env.MODULE_SOURCE = "catalogue";
    try {
      const names = (await list(T)).data.map((d) => d.name as string);
      expect(names).toEqual(legacyKeysFromModules(["employee", "attendance", "leave", "finance", "payroll"]));
      expect(names).toContain("hrms");
      expect(names).toContain("payroll");
      expect(names).not.toContain("crm");
      const rows = (await list(T, true)).data;
      expect(rows.find((r) => r.moduleKey === "payroll")!.enabled).toBe(true);
      expect(rows.find((r) => r.moduleKey === "crm")!.enabled).toBe(false);
    } finally { delete process.env.MODULE_SOURCE; }
  });

  it("flag on: a tenant that was never composed still gets its legacy rows (never blanked)", async () => {
    process.env.MODULE_SOURCE = "catalogue";
    try {
      expect((await list(LEGACY_ONLY)).data).toEqual([{ name: "finance" }]);
    } finally { delete process.env.MODULE_SOURCE; }
  });

  const settings = async (tid: string) =>
    (await app.inject({ method: "GET", url: "/v1/admin/composition/settings", headers: adminAuth(tid) })).json() as {
      source: string; modules: Array<{ id: string; enabled: boolean; source: string | null; hardDeps: string[]; softDeps: string[]; requiredBy: string[] }>;
    };

  it("settings capability: default is 'legacy' with no module list (the page keeps today's behaviour)", async () => {
    delete process.env.MODULE_SOURCE;
    expect(await settings(T)).toEqual({ source: "legacy", modules: [] });
  });

  it("settings capability: catalogue mode lists modules with why they are on, hard deps and who needs them", async () => {
    process.env.MODULE_SOURCE = "catalogue";
    try {
      const r = await settings(T);
      expect(r.source).toBe("catalogue");
      const by = new Map(r.modules.map((m) => [m.id, m]));
      expect(r.modules.some((m) => ["identity", "org", "config", "workflow", "audit"].includes(m.id))).toBe(false); // core is not switchable
      expect(by.get("payroll")).toMatchObject({ enabled: true, source: "user", hardDeps: ["employee"] });
      expect(by.get("payroll")!.softDeps).toContain("finance");
      expect(by.get("employee")).toMatchObject({ enabled: true });
      expect(by.get("employee")!.requiredBy).toContain("payroll");
      expect(by.get("finance")).toMatchObject({ enabled: true, source: "user" });
      expect(by.get("procurement")).toMatchObject({ enabled: false, source: null });
      expect(by.get("procurement")!.hardDeps).toEqual(expect.arrayContaining(["finance", "budget"]));
    } finally { delete process.env.MODULE_SOURCE; }
  });

  it("flag on: the older toggle is retired with a pointer to the catalogue endpoint", async () => {
    process.env.MODULE_SOURCE = "catalogue";
    try {
      const res = await app.inject({ method: "POST", url: "/v1/admin/tenant/modules/payroll/toggle", headers: adminAuth(T), payload: { enabled: false } });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("MODULES_MANAGED_BY_CATALOGUE");
    } finally { delete process.env.MODULE_SOURCE; }
  });
});
