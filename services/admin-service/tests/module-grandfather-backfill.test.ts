/**
 * ST-M01-02 review round 1 — grandfather backfill + enforcement-mode write path.
 *
 * Runs the REAL migration 0050 (idempotent) against seeded legacy
 * admin.module_configs rows and asserts, end to end through the internal
 * projection the gateway reads, that a backfilled tenant is configured:true and
 * carries every legacy gateway key (incl. telephony/meeting/court/visitor/
 * billing), so `enforce` does not lock it out. Also covers the CQRS enforcement
 * mode write (202 -> consumer -> audit + post-commit event) and readiness.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerCompositionConsumers } = await import("../src/modules/composition/consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const LEGACY = "d8000000-0000-4000-8000-0000000000b1";
const COMPOSED = "d8000000-0000-4000-8000-0000000000b2";
const EMPTY = "d8000000-0000-4000-8000-0000000000b3";
const ADMIN = "d8000000-eeee-4000-8000-000000000001";
const TENANTS = [LEGACY, COMPOSED, EMPTY];
const LEGACY_KEYS = ["hrms", "payroll", "finance", "telephony", "meeting", "court", "visitor", "billing", "analytics"];

const superAuth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid, roles: ["super_admin"], sid: "s" }, SECRET, 3600)}` });

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
async function drain(): Promise<void> {
  const q = queue as unknown as { drain?: () => Promise<void> };
  expect(typeof q.drain).toBe("function");
  await q.drain!();
}
const projection = async (app: FastifyInstance, t: string) =>
  (await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${t}/modules`, headers: superAuth(t) })).json();

let app: FastifyInstance;
beforeAll(async () => {
  registerCompositionConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
  // Legacy tenant: enabled gateway module-keys only in admin.module_configs.
  await asTenant(LEGACY, async (sql) => {
    for (const k of LEGACY_KEYS) {
      await sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${LEGACY}, ${k}, true, ${ADMIN}, ${ADMIN})`;
    }
    await sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${LEGACY}, 'crm', false, ${ADMIN}, ${ADMIN})`;
  });
  // Already-composed tenant with module_configs too: backfill must leave it alone.
  await asTenant(COMPOSED, async (sql) => {
    await sql`INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by) VALUES (${COMPOSED}, 'payroll', true, ${ADMIN}, ${ADMIN})`;
    await sql`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by) VALUES (${COMPOSED}, 'crm', 'user', ${ADMIN})`;
  });
  // Re-run the REAL migration (idempotent; runs as the table owner like bootstrap).
  const sqlText = readFileSync(new URL("../migrations/0050_module_enforcement_mode.sql", import.meta.url), "utf8");
  await sqlClient.unsafe(sqlText);
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("migration 0050 grandfather backfill", () => {
  it("writes source='grandfather' rows for a legacy tenant incl. telephony/meeting/court/visitor/billing", async () => {
    const rows = await asTenant(LEGACY, (sql) =>
      sql<Array<{ module_id: string; source: string }>>`SELECT module_id, source FROM composition.tenant_entitlement WHERE tenant_id = ${LEGACY}`);
    const ids = rows.map((r) => r.module_id);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["grandfather"]));
    for (const id of ["telephony", "meeting", "court", "visitor", "billing", "payroll", "finance", "analytics", "employee"]) expect(ids).toContain(id);
    expect(ids).not.toContain("crm"); // disabled legacy module is NOT entitled
  });

  it("is a no-op for an already-composed tenant and for a tenant with nothing enabled", async () => {
    const composed = await asTenant(COMPOSED, (sql) =>
      sql<Array<{ module_id: string; source: string }>>`SELECT module_id, source FROM composition.tenant_entitlement WHERE tenant_id = ${COMPOSED}`);
    expect(composed).toEqual([{ module_id: "crm", source: "user" }]);
    const empty = await asTenant(EMPTY, (sql) => sql`SELECT 1 FROM composition.tenant_entitlement WHERE tenant_id = ${EMPTY}`);
    expect(empty).toHaveLength(0);
  });

  it("the gateway projection reads grandfather rows: configured:true with every legacy route key", async () => {
    const body = await projection(app, LEGACY);
    expect(body.configured).toBe(true); // was false before the fix => enforce 403'd everything
    const keys = body.data.map((m: { name: string }) => m.name);
    for (const k of ["hrms", "payroll", "finance", "telephony", "meeting", "court", "visitor", "billing", "analytics"]) expect(keys).toContain(k);
    expect(keys).not.toContain("crm");
  });

  it("re-running the migration is idempotent (no duplicate/changed rows)", async () => {
    const before = await asTenant(LEGACY, (sql) => sql`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${LEGACY}`);
    const sqlText = readFileSync(new URL("../migrations/0050_module_enforcement_mode.sql", import.meta.url), "utf8");
    await sqlClient.unsafe(sqlText);
    const after = await asTenant(LEGACY, (sql) => sql`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${LEGACY}`);
    expect(after).toHaveLength(before.length);
  });
});

describe("PUT enforcement-mode: CQRS write path + readiness", () => {
  const put = (t: string, mode: string, corr = randomUUID()) =>
    app.inject({ method: "PUT", url: `/v1/admin/composition/${t}/enforcement-mode`, headers: { ...superAuth(t), "x-correlation-id": corr }, payload: { mode } });

  it("refuses enforce for a tenant with no composition (409) and writes nothing", async () => {
    const res = await put(EMPTY, "enforce");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("COMPOSITION_NOT_CONFIGURED");
    await drain();
    const rows = await asTenant(EMPTY, (sql) => sql`SELECT 1 FROM composition.tenant_enforcement_mode WHERE tenant_id = ${EMPTY}`);
    expect(rows).toHaveLength(0);
  });

  it("allows shadow/off for an un-composed tenant", async () => {
    expect((await put(EMPTY, "shadow")).statusCode).toBe(202);
    await drain();
    expect((await put(EMPTY, "off")).statusCode).toBe(202);
    await drain();
  });

  it("accepts enforce for a grandfathered tenant: 202, row written by the consumer, audit + post-commit event enqueued", async () => {
    const corr = randomUUID();
    const res = await put(LEGACY, "enforce", corr);
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    // nothing is written on the request path
    const pre = await asTenant(LEGACY, (sql) => sql`SELECT mode FROM composition.tenant_enforcement_mode WHERE tenant_id = ${LEGACY}`);
    expect(pre).toHaveLength(0);
    await drain();
    const post = await asTenant(LEGACY, (sql) => sql<Array<{ mode: string }>>`SELECT mode FROM composition.tenant_enforcement_mode WHERE tenant_id = ${LEGACY}`);
    expect(post[0]?.mode).toBe("enforce");
    const out = await sqlClient<Array<{ topic: string; payload: Record<string, unknown> }>>`
      SELECT topic, payload FROM _outbox.messages WHERE tenant_id = ${LEGACY} AND correlation_id = ${corr}`;
    const topics = out.map((o) => o.topic);
    expect(topics).toContain("audit.event.record");
    expect(topics).toContain("admin.composition.enforcement_mode_changed");
    const proj = await projection(app, LEGACY);
    expect(proj.mode).toBe("enforce");
    expect(proj.configured).toBe(true);
  });

  it("a replayed command (same correlation id) is applied once", async () => {
    const corr = randomUUID();
    await put(LEGACY, "shadow", corr);
    await drain();
    await put(LEGACY, "enforce", corr); // same messageId => deduped at _inbox.processed
    await drain();
    const row = await asTenant(LEGACY, (sql) => sql<Array<{ mode: string }>>`SELECT mode FROM composition.tenant_enforcement_mode WHERE tenant_id = ${LEGACY}`);
    expect(row[0]?.mode).toBe("shadow");
  });
});
