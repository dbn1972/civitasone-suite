/**
 * GAP-FIELD-HOME-04 / owner decision #36 — the `field` composition module.
 *
 * The gateway now gates /api/v1/field behind entitlement (module-guard
 * ROUTE_TO_MODULE field -> "field"). That is only correct if the admin
 * composition catalogue can actually grant `field`. Without a registry row and
 * a gateway-map entry EVERY tenant (entitled or not) is denied under
 * enforcement. These tests pin:
 *   - the catalogue contains `field` and maps it to the gateway key `field`;
 *   - an entitled tenant's internal projection (what the gateway reads) carries
 *     `field`, an un-entitled tenant's does NOT (gateway then fails closed);
 *   - the REAL migration 0056 grandfathers every tenant that reaches field
 *     today (composition entitlement + legacy modules-list), idempotently.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerCompositionConsumers } = await import("../src/modules/composition/consumer.js");
const { toGatewayKeys, COMPOSITION_TO_GATEWAY_KEYS } = await import("../src/modules/composition/gateway-map.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ADMIN = "d9100000-eeee-4000-8000-000000000001";
const ENTITLED = "d9100000-0000-4000-8000-0000000000a1"; // govt_dept profile
const UNENTITLED = "d9100000-0000-4000-8000-0000000000a2"; // small_office profile (no field)
const COMPOSED_OLD = "d9100000-0000-4000-8000-0000000000a3"; // pre-0056 entitlement, no field
const LEGACY = "d9100000-0000-4000-8000-0000000000a4"; // modules-list tenant, no field
const TENANTS = [ENTITLED, UNENTITLED, COMPOSED_OLD, LEGACY];

const superAuth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid, roles: ["super_admin"], sid: "s" }, SECRET, 3600)}` });
const adminAuth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600)}` });

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}
async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, async (sql) => {
      await sql`DELETE FROM config.admin_module_configs WHERE tenant_id = ${t}`;
      await sql`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
      await sql`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
      await sql`DELETE FROM composition.tenant_enforcement_mode WHERE tenant_id = ${t}`;
    });
  }
}
const projection = async (app: FastifyInstance, t: string) =>
  (await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${t}/modules`, headers: superAuth(t) })).json() as {
    configured: boolean;
    data: { name: string }[];
  };
const keysOf = (p: { data: { name: string }[] }) => p.data.map((m) => m.name);
// Runs the REAL migration 0056 text, but per test tenant inside a tenant-scoped
// tx: the migration drops/restores FORCE RLS around its cross-tenant DML, and
// toggling that on the shared DB while parallel test files run would race them.
// Under the tenant GUC the (unchanged) DML is confined to that tenant's own rows
// by RLS, so the production statements are exercised without cross-test effects.
const MIGRATION_TEXT = readFileSync(new URL("../migrations/0056_field_module_catalogue.sql", import.meta.url), "utf8");
const FORCE_LINES = /^ALTER TABLE .*FORCE ROW LEVEL SECURITY;$/gm;
const runMigration = async () => {
  expect(MIGRATION_TEXT.match(FORCE_LINES)).toHaveLength(4);
  const text = MIGRATION_TEXT.replace(FORCE_LINES, "");
  for (const t of TENANTS) await asTenant(t, (sql) => sql.unsafe(text));
};
const entitlements = (t: string) =>
  asTenant(t, (sql) =>
    sql<{ module_id: string; source: string }[]>`SELECT module_id, source FROM composition.tenant_entitlement WHERE tenant_id = ${t} ORDER BY module_id`);

let app: FastifyInstance;
beforeAll(async () => {
  registerCompositionConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
  // Onboard through the real path: govt_dept defaults include field, small_office does not.
  for (const [t, profile] of [[ENTITLED, "govt_dept"], [UNENTITLED, "small_office"]] as const) {
    await app.inject({ method: "POST", url: "/v1/admin/composition/onboard", headers: adminAuth(t), payload: { profile } });
  }
  // A tenant composed BEFORE field existed: holds inspection, no field row.
  await asTenant(COMPOSED_OLD, (sql) =>
    sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${COMPOSED_OLD}, 'inspection', 'user', ${ADMIN})`);
  // A legacy modules-list tenant: allow-list has finance only.
  await asTenant(LEGACY, (sql) =>
    sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${LEGACY}, 'finance', true, ${ADMIN}, ${ADMIN})`);
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("field is in the composition catalogue", () => {
  it("module_registry contains `field` (non-core, global catalogue row)", async () => {
    const rows = await sqlClient<{ id: string; is_core: boolean; name: string }[]>`SELECT id, is_core, name FROM composition.module_registry WHERE id = 'field'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_core).toBe(false);
    expect(rows[0]!.name).toBe("Field Operations");
  });
  it("gateway-map projects `field` to the gateway key `field`", () => {
    expect(COMPOSITION_TO_GATEWAY_KEYS.field).toEqual(["field"]);
    expect(toGatewayKeys(["field"])).toEqual(["field"]);
  });
  it("the governance bundle and govt_dept/psu profiles carry field; small_office does not", async () => {
    const [b] = await sqlClient<{ module_ids: string[] }[]>`SELECT module_ids FROM composition.module_bundle WHERE code = 'governance'`;
    expect(b!.module_ids).toContain("field");
    const profiles = await sqlClient<{ code: string; default_modules: string[] }[]>`SELECT code, default_modules FROM composition.org_profile WHERE code IN ('govt_dept','psu','small_office')`;
    const by = Object.fromEntries(profiles.map((p) => [p.code, p.default_modules]));
    expect(by.govt_dept).toContain("field");
    expect(by.psu).toContain("field");
    expect(by.small_office).not.toContain("field");
  });
});

describe("gateway projection (what module-guard reads)", () => {
  it("an entitled tenant's allow-list includes `field` (so /api/v1/field passes)", async () => {
    const p = await projection(app, ENTITLED);
    expect(p.configured).toBe(true);
    expect(keysOf(p)).toContain("field");
  });
  it("an un-entitled tenant's allow-list omits `field` (gateway fails closed)", async () => {
    const p = await projection(app, UNENTITLED);
    expect(p.configured).toBe(true);
    expect(keysOf(p)).not.toContain("field");
  });
});

describe("migration 0056 grandfather", () => {
  it("a tenant composed before field existed is denied until the migration, then keeps access", async () => {
    expect(keysOf(await projection(app, COMPOSED_OLD))).not.toContain("field");
    await runMigration();
    expect(await entitlements(COMPOSED_OLD)).toContainEqual({ module_id: "field", source: "grandfather" });
    expect(keysOf(await projection(app, COMPOSED_OLD))).toContain("field");
  });
  it("a legacy modules-list tenant gets an enabled `field` row", async () => {
    const rows = await asTenant(LEGACY, (sql) =>
      sql<{ module_key: string; enabled: boolean }[]>`SELECT module_key, enabled FROM config.admin_module_configs WHERE tenant_id = ${LEGACY} ORDER BY module_key`);
    expect(rows).toContainEqual({ module_key: "field", enabled: true });
  });
  it("never overrides a tenant's own field row, and re-running changes nothing", async () => {
    const before = await Promise.all(TENANTS.map(entitlements));
    await runMigration();
    expect(await Promise.all(TENANTS.map(entitlements))).toEqual(before);
    // A tenant that explicitly disabled field in its modules-list keeps it disabled.
    await asTenant(LEGACY, (sql) => sql`UPDATE config.admin_module_configs SET enabled = false WHERE tenant_id = ${LEGACY} AND module_key = 'field'`);
    await runMigration();
    const [row] = await asTenant(LEGACY, (sql) =>
      sql<{ enabled: boolean }[]>`SELECT enabled FROM config.admin_module_configs WHERE tenant_id = ${LEGACY} AND module_key = 'field'`);
    expect(row!.enabled).toBe(false);
  });
});
