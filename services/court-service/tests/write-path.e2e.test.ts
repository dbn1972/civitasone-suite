/**
 * WRITE-path + §47 full-loop end-to-end — REAL Postgres + the REAL worker wiring,
 * in one process, under the NON-superuser court_svc role.
 *
 * Part A (write path): a command flows HTTP route → in-memory queue → worker
 * router (which establishes tenant context via runWithTenant) → consumer →
 * db.transaction (app.tenant_id GUC set) → INSERT accepted under RLS; the written
 * row is invisible to another tenant; and a config-invalid courtType is rejected
 * through the full stack (dead-lettered, never written).
 *
 * Part B (§47 full loop): applying a VERTICAL PRESET seeds a tenant's config, and
 * because config is authoritative-when-present the tenant is then RESTRICTED to
 * that vertical — a preset type is accepted while a built-in default that is NOT
 * in the preset is rejected. Proves preset → config → validation, end to end.
 *
 * Opt-in via COURT_E2E=1. Default `vitest run` skips (DB is mocked there).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { subscribeConsumers } from "../src/worker.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const PRESET_TENANT = "55555555-5555-5555-5555-555555555555";
const ACTOR = "3333aaaa-3333-4333-8333-333333333333"; // a valid UUID — becomes created_by (uuid column)

function token(tenantId: string, roles: string[] = ["court_admin"]): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-wp" }, SECRET, 3600);
}

let app: FastifyInstance;

async function listCourtNames(tenantId: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: "/v1/court/courts", headers: { authorization: `Bearer ${token(tenantId)}` } });
  return res.statusCode === 200 ? (res.json().items as Array<{ name: string }>).map((c) => c.name) : [];
}
async function listConfigKeys(tenantId: string, namespace: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: `/v1/court/config/${namespace}?active=true`, headers: { authorization: `Bearer ${token(tenantId)}` } });
  return res.statusCode === 200 ? (res.json().items as Array<{ configKey: string }>).map((c) => c.configKey) : [];
}
async function createCourt(tenantId: string, name: string, courtType: string): Promise<number> {
  const res = await app.inject({
    method: "POST", url: "/v1/court/courts",
    headers: { authorization: `Bearer ${token(tenantId)}`, "content-type": "application/json" },
    payload: { name, courtType },
  });
  return res.statusCode;
}
async function waitFor(pred: () => Promise<boolean>, tries = 40, gapMs = 25): Promise<boolean> {
  for (let i = 0; i < tries; i++) { if (await pred()) return true; await new Promise((r) => setTimeout(r, gapMs)); }
  return false;
}

describe.skipIf(!RUN)("court-service write-path + §47 full loop (e2e, real DB, RLS)", () => {
  const validName = `WP Valid ${Date.now()}`;
  const invalidName = `WP Invalid ${Date.now()}`;
  const presetCourtName = `Preset OK ${Date.now()}`;
  const restrictedName = `Preset Restricted ${Date.now()}`;

  beforeAll(async () => {
    subscribeConsumers();          // wire the REAL module consumers onto the shared queue
    await queue.start();
    app = await buildApp();
  });

  afterAll(async () => {
    await queue.stop();
    for (const t of [TENANT, PRESET_TENANT]) {
      await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${t}, true)`;
        await sql`delete from court.courts where tenant_id = ${t}`;
        await sql`delete from court.config_entries where tenant_id = ${t}`;
      });
    }
    await app.close();
    await sqlClient.end();
  });

  // ── Part A: write path ─────────────────────────────────────────────────────
  it("a valid create flows through the worker and lands in the DB (write-side RLS)", async () => {
    expect(await createCourt(TENANT, validName, "tehsildar")).toBe(202);
    expect(await waitFor(async () => (await listCourtNames(TENANT)).includes(validName))).toBe(true);
  });

  it("the worker-written row is invisible to another tenant (RLS end-to-end)", async () => {
    expect((await listCourtNames(OTHER)).includes(validName)).toBe(false);
  });

  it("a config-invalid courtType is rejected through the full stack (never written)", async () => {
    expect(await createCourt(TENANT, invalidName, "totally_made_up_type")).toBe(202);
    expect(await waitFor(async () => (await listCourtNames(TENANT)).includes(invalidName), 12, 25)).toBe(false);
  });

  // ── Part B: §47 full loop — preset seeds config that RESTRICTS the tenant ────
  it("applying the 'consumer' preset seeds the tenant's court_type config", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/court/config/presets/consumer",
      headers: { authorization: `Bearer ${token(PRESET_TENANT)}`, "content-type": "application/json" },
      payload: {}, // preset name is in the path; empty JSON body (Fastify rejects content-type json with no body)
    });
    expect(res.statusCode).toBe(202);
    // wait for the fanned-out config.set commands to be consumed
    expect(await waitFor(async () => (await listConfigKeys(PRESET_TENANT, "court_type")).includes("consumer_commission"))).toBe(true);
  });

  it("accepts a courtType that the preset configured (consumer_commission)", async () => {
    expect(await createCourt(PRESET_TENANT, presetCourtName, "consumer_commission")).toBe(202);
    expect(await waitFor(async () => (await listCourtNames(PRESET_TENANT)).includes(presetCourtName))).toBe(true);
  });

  it("REJECTS a built-in default type not in the preset — config is authoritative (§47)", async () => {
    // 'tehsildar' is a DEFAULT court type, but the consumer preset does not include
    // it; once the tenant has configured court_type, its set is authoritative.
    expect(await createCourt(PRESET_TENANT, restrictedName, "tehsildar")).toBe(202);
    expect(await waitFor(async () => (await listCourtNames(PRESET_TENANT)).includes(restrictedName), 12, 25)).toBe(false);
  });
});
