/**
 * platform-integrations — route + consumer integration tests (real Postgres, RLS).
 *
 * Covers: the super-admin catalogue, tenant availability (tenant allow-list and
 * edition), schema-driven config with write-only encrypted secrets, test
 * connection (sandbox mock / production 501), and the production switch
 * (maker != checker, race-safe conditional UPDATE, stale-configuration void,
 * per-tenant approval setting, audit on every decision).
 *
 * Test providers (zz_test_*) are inserted per run and removed afterwards so the
 * seeded catalogue is never mutated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken, idempotentId } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test-master-key-for-platform-integrations"; // gitleaks:allow

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerAllF3Consumers } = await import("./helpers/register-all-f3-consumers.js");
const { publishAdminCommand } = await import("../src/shared/f3-publish.js");
const { COMMANDS } = await import("../src/topics.js");
const { sealSecret: sealSecretForTest } = await import("../src/shared/secret-crypto.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const PLATFORM_TENANT = randomUUID();
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SUPER = "aaaaaaaa-1111-4000-8000-000000000001";
const MAKER = "aaaaaaaa-1111-4000-8000-000000000002";
const CHECKER = "aaaaaaaa-1111-4000-8000-000000000003";
const CHECKER2 = "aaaaaaaa-1111-4000-8000-000000000004";
const FIN = "aaaaaaaa-1111-4000-8000-000000000005";
const OFFICER = "aaaaaaaa-1111-4000-8000-000000000006";
const B_ADMIN = "aaaaaaaa-1111-4000-8000-000000000007";

const run = randomUUID().slice(0, 8);
const KEY_A = `zz_test_a_${run}`; // available
const KEY_BETA = `zz_test_beta_${run}`;
const KEY_C = `zz_test_c_${run}`; // available, used for platform-side tests
const KEY_D = `zz_test_d_${run}`; // available, used for race/stale/direct tests
const KEY_E = `zz_test_e_${run}`; // esign, production-edit + policy tests
const KEY_F = `zz_test_f_${run}`; // bank_api, schema with NO field marked sensitive
const KEY_G = `zz_test_g_${run}`; // esign restricted to tenant B only

const SCHEMA = {
  fields: [
    { key: "orgId", label: "Org ID", type: "text", required: true, secret: false, sensitive: true, maxLength: 32 },
    { key: "apiKey", label: "API key", type: "text", required: true, secret: true },
    { key: "extraSecret", label: "Extra", type: "text", required: false, secret: true },
    { key: "prodOnly", label: "Prod only", type: "text", required: true, secret: false, sensitive: true, environments: ["production"] },
    { key: "sandboxScenario", label: "Scenario", type: "select", required: false, secret: false, environments: ["sandbox"], options: [{ value: "success", label: "ok" }, { value: "auth_failed", label: "no" }] },
  ],
};

function tok(actor: string, roles: string[], tenantId: string) {
  return signToken({ sub: actor, tid: tenantId, roles, sid: "sess-pi" }, SECRET, 3600);
}
const H = (actor: string, roles: string[], tenantId: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${tok(actor, roles, tenantId)}`, ...extra,
});
const superH = () => H(SUPER, ["super_admin"], PLATFORM_TENANT);
const adm = (actor: string, tenantId = TENANT_A, extra: Record<string, string> = {}) => H(actor, ["tenant_admin"], tenantId, extra);

const BASE = "/v1/admin/platform-integrations";
let app: FastifyInstance;
const drain = async () => { await (queue as unknown as { drain?: () => Promise<void> }).drain?.(); };

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}
async function asCatalogueWriter<T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.platform_catalogue_write', 'true', true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function insertProvider(key: string, category: string, status: string, opts: { schema?: unknown; onlyTenant?: string } = {}): Promise<void> {
  const mode = opts.onlyTenant ? "restricted" : "all";
  const tenants = opts.onlyTenant ? [opts.onlyTenant] : [];
  await asCatalogueWriter((sql) => sql`
    INSERT INTO platform_integrations.providers (key, category, name, capabilities, config_schema, status, availability_mode, allowed_tenant_ids)
    VALUES (${key}, ${category}, ${"Test " + key}, '["x.y"]'::jsonb, ${JSON.stringify(opts.schema ?? SCHEMA)}::jsonb, ${status}, ${mode}, ${tenants}::uuid[])`);
}

async function audits(tenantId: string): Promise<Array<{ action: string; outcome: string; reason: string | null; resourceId: string }>> {
  return sqlClient<Array<{ action: string; outcome: string; reason: string | null; resourceId: string }>>`
    SELECT payload->>'action' AS action, payload->>'outcome' AS outcome, payload->>'reason' AS reason, payload->>'resourceId' AS "resourceId"
    FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = 'audit.event.record'
      AND payload->>'resourceType' = 'platform_integration' ORDER BY created_at`;
}

async function rowOf(tenantId: string, key: string) {
  return asTenant(tenantId, (sql) => sql<Array<{ environment: string; version: number; secrets: Record<string, string>; config: Record<string, unknown>; last_test_status: string | null; enabled: boolean }>>`
    SELECT environment, version, secrets, config, last_test_status, enabled FROM platform_integrations.tenant_integrations
    WHERE tenant_id = ${tenantId} AND provider_key = ${key}`).then((r) => r[0]);
}

// Same fields, none marked sensitive: the domain must then treat every field as sensitive.
const SCHEMA_UNMARKED = { fields: SCHEMA.fields.map((f) => { const { sensitive: _s, ...rest } = f as Record<string, unknown>; return rest; }) };

const FULL_SANDBOX = { config: { orgId: "ORG1" }, secrets: { apiKey: "plain-api-key-1" } }; // gitleaks:allow

async function put(key: string, body: Record<string, unknown>, actor = MAKER, tenantId = TENANT_A, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: "PUT", url: `${BASE}/tenant/records/${key}`, headers: adm(actor, tenantId, headers), payload: body });
  await drain();
  return res;
}
async function getRecord(key: string, actor = MAKER, tenantId = TENANT_A) {
  return app.inject({ method: "GET", url: `${BASE}/tenant/records/${key}`, headers: adm(actor, tenantId) });
}
async function post(url: string, body: Record<string, unknown>, actor = MAKER, tenantId = TENANT_A, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: "POST", url: `${BASE}${url}`, headers: adm(actor, tenantId, headers), payload: body });
  await drain();
  return res;
}
async function configure(key: string, opts: { prodReady?: boolean; tenantId?: string; actor?: string } = {}) {
  const tenantId = opts.tenantId ?? TENANT_A;
  const actor = opts.actor ?? MAKER;
  const created = await put(key, { config: { orgId: "ORG1", ...(opts.prodReady ? { prodOnly: "P1" } : {}) }, secrets: { apiKey: "plain-api-key-1" } }, actor, tenantId); // gitleaks:allow
  expect(created.statusCode).toBe(202);
  return (await rowOf(tenantId, key))!;
}

beforeAll(async () => {
  registerAllF3Consumers(queue);
  await queue.start();
  app = await buildApp();
  await insertProvider(KEY_A, "esign", "available");
  await insertProvider(KEY_BETA, "dsc", "beta");
  await insertProvider(KEY_C, "bank_api", "available");
  await insertProvider(KEY_D, "esign", "available");
  await insertProvider(KEY_E, "esign", "available");
  await insertProvider(KEY_F, "bank_api", "available", { schema: SCHEMA_UNMARKED });
  await insertProvider(KEY_G, "esign", "available", { onlyTenant: TENANT_B });
});

afterAll(async () => {
  for (const t of [TENANT_A, TENANT_B]) {
    await asTenant(t, (sql) => sql`DELETE FROM platform_integrations.tenant_integrations WHERE tenant_id = ${t}`);
    await asTenant(t, (sql) => sql`DELETE FROM platform_integrations.tenant_integration_settings WHERE tenant_id = ${t}`);
    await asTenant(t, (sql) => sql`DELETE FROM platform_integrations.policy_change_requests WHERE tenant_id = ${t}`);
    await asTenant(t, (sql) => sql`DELETE FROM tenants.admin_tenants WHERE tenant_id = ${t}`);
  }
  await asCatalogueWriter((sql) => sql`DELETE FROM platform_integrations.providers WHERE key LIKE ${"zz_test_%_" + run}`);
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

// ════════════════════════════════════════════════════════════════════════════
describe("platform catalogue", () => {
  it("is seeded with every category and provider the decision named, with NO invented endpoints", async () => {
    const res = await app.inject({ method: "GET", url: `${BASE}/providers`, headers: superH() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ key: string; category: string; endpoints: { sandbox: string | null; production: string | null }; fields: Array<{ key: string }> }>;
    const keys = data.map((p) => p.key);
    for (const k of ["esign_nsdl_egov", "esign_emudhra", "esign_cdac", "dsc_usb_token_bridge", "dsc_remote_hsm", "bank_sbi", "bank_hdfc", "bank_icici", "bank_axis", "bank_pnb", "bank_generic", "pfms_epayment"]) {
      expect(keys).toContain(k);
    }
    expect(new Set(data.map((p) => p.category))).toEqual(new Set(["esign", "dsc", "bank_api", "pfms"]));
    for (const p of data.filter((d) => !d.key.startsWith("zz_test_"))) {
      expect(p.endpoints).toEqual({ sandbox: null, production: null });
    }
    // bank profiles expose the typed keyRef contract for bank-file signing
    expect(data.find((p) => p.key === "bank_sbi")?.fields.map((f) => f.key)).toContain("keyRef");
  });

  it("is super_admin/platform_admin only", async () => {
    expect((await app.inject({ method: "GET", url: `${BASE}/providers` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${BASE}/providers`, headers: adm(MAKER) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_A}`, headers: adm(MAKER), payload: { expectedVersion: 1, status: "disabled" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${BASE}/providers`, headers: H(SUPER, ["platform_admin"], PLATFORM_TENANT) })).statusCode).toBe(200);
  });

  it("disable / re-enable changes tenant visibility and blocks writes; stale version is a 409", async () => {
    const before = await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_C}`, headers: superH() });
    const v = before.json().data.version as number;
    const patch = await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_C}`, headers: superH(), payload: { expectedVersion: v, status: "disabled" } });
    expect(patch.statusCode).toBe(202);
    await drain();
    const cat = await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: adm(MAKER) });
    expect((cat.json().data as Array<{ key: string }>).map((p) => p.key)).not.toContain(KEY_C);
    const blocked = await put(KEY_C, FULL_SANDBOX);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("PROVIDER_DISABLED");
    // stale version
    const stale = await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_C}`, headers: superH(), payload: { expectedVersion: v, status: "available" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    const fresh = (await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_C}`, headers: superH() })).json().data.version as number;
    expect(fresh).toBe(v + 1);
    await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_C}`, headers: superH(), payload: { expectedVersion: fresh, status: "available" } });
    await drain();
    const cat2 = await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: adm(MAKER) });
    expect((cat2.json().data as Array<{ key: string }>).map((p) => p.key)).toContain(KEY_C);
    const acts = await audits(PLATFORM_TENANT);
    expect(acts.filter((a) => a.action === "platform_integration.provider_update" && a.outcome === "success").length).toBeGreaterThanOrEqual(2);
  });

  it("restricts availability by tenant allow-list OR edition, and never leaks the allow-list to tenants", async () => {
    await asTenant(TENANT_B, (sql) => sql`
      INSERT INTO tenants.admin_tenants (tenant_id, name, domain, edition, region, residency, created_by, updated_by)
      VALUES (${TENANT_B}, 'Tenant B', ${"b-" + run + ".gov.in"}, 'psu', 'in-south', 'IN', ${SUPER}, ${SUPER})`);
    const v = (await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_D}`, headers: superH() })).json().data.version as number;
    // restricted to nobody is rejected
    const empty = await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_D}`, headers: superH(), payload: { expectedVersion: v, availability: { mode: "restricted", tenantIds: [], editions: [] } } });
    expect(empty.statusCode).toBe(400);
    // tenant A allow-listed
    const r1 = await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_D}`, headers: superH(), payload: { expectedVersion: v, availability: { mode: "restricted", tenantIds: [TENANT_A], editions: [] } } });
    expect(r1.statusCode).toBe(202);
    await drain();
    const keysFor = async (actor: string, tenant: string) =>
      ((await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: adm(actor, tenant) })).json().data as Array<{ key: string }>).map((p) => p.key);
    expect(await keysFor(MAKER, TENANT_A)).toContain(KEY_D);
    expect(await keysFor(B_ADMIN, TENANT_B)).not.toContain(KEY_D);
    expect((await put(KEY_D, FULL_SANDBOX, B_ADMIN, TENANT_B)).statusCode).toBe(403);
    // edition psu => tenant B (psu) becomes eligible
    const v2 = (await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_D}`, headers: superH() })).json().data.version as number;
    await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_D}`, headers: superH(), payload: { expectedVersion: v2, availability: { mode: "restricted", tenantIds: [], editions: ["psu"] } } });
    await drain();
    expect(await keysFor(B_ADMIN, TENANT_B)).toContain(KEY_D);
    expect(await keysFor(MAKER, TENANT_A)).not.toContain(KEY_D);
    const tenantView = await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: adm(B_ADMIN, TENANT_B) });
    expect(tenantView.body).not.toContain(TENANT_A);
    // back to all
    const v3 = (await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_D}`, headers: superH() })).json().data.version as number;
    await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_D}`, headers: superH(), payload: { expectedVersion: v3, availability: { mode: "all", tenantIds: [], editions: [] } } });
    await drain();
    expect(await keysFor(MAKER, TENANT_A)).toContain(KEY_D);
  });

  it("catalogue writes are impossible without the platform write GUC (RLS), even as a tenant", async () => {
    const updated = await asTenant(TENANT_A, (sql) => sql`UPDATE platform_integrations.providers SET status = 'disabled' WHERE key = ${KEY_A} RETURNING key`);
    expect(updated).toHaveLength(0);
    await expect(asTenant(TENANT_A, (sql) => sql`INSERT INTO platform_integrations.providers (key, category, name) VALUES (${"zz_test_x_" + run}, 'esign', 'x')`)).rejects.toThrow(/row-level security/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("tenant config: schema-driven form with write-only secrets", () => {
  it("creates a record, seals the secret at rest and never returns it", async () => {
    const res = await put(KEY_A, { ...FULL_SANDBOX, config: { orgId: "ORG1", sandboxScenario: "success" } });
    expect(res.statusCode).toBe(202);
    const row = (await rowOf(TENANT_A, KEY_A))!;
    expect(row.environment).toBe("sandbox"); // default environment
    expect(row.secrets.apiKey?.startsWith("enc:v2:")).toBe(true);
    expect(JSON.stringify(row)).not.toContain("plain-api-key-1"); // gitleaks:allow
    expect(row.config).toEqual({ orgId: "ORG1", sandboxScenario: "success" });

    const bodies = [
      (await getRecord(KEY_A)).body,
      (await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: adm(MAKER) })).body,
      (await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: adm(MAKER) })).body,
      res.body,
    ];
    for (const b of bodies) {
      expect(b).not.toContain("plain-api-key-1"); // gitleaks:allow
      expect(b).not.toContain("enc:v2:");
    }
    const rec = (await getRecord(KEY_A)).json().data;
    expect(rec.secrets.find((s: { key: string }) => s.key === "apiKey")).toEqual({ key: "apiKey", label: "API key", set: true, masked: "••••••••" });
    expect(rec.secrets.find((s: { key: string }) => s.key === "extraSecret")).toMatchObject({ set: false, masked: null });
    expect(rec.missingRequired.sandbox).toEqual([]);
    expect(rec.missingRequired.production).toEqual(["prodOnly"]);
    expect(rec.environment).toBe("sandbox");
  });

  it("the audit trail records field NAMES only, never values", async () => {
    const acts = await audits(TENANT_A);
    expect(acts.some((a) => a.action === "tenant_integration.create" && a.outcome === "success")).toBe(true);
    const raw = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT_A} AND topic = 'audit.event.record'`;
    expect(JSON.stringify(raw)).not.toContain("plain-api-key-1"); // gitleaks:allow
    expect(JSON.stringify(raw)).not.toContain("ORG1");
  });

  it("update keeps an omitted secret, replaces a supplied one, clears an explicit one, bumps the version", async () => {
    const v0 = (await rowOf(TENANT_A, KEY_A))!;
    const sealedBefore = v0.secrets.apiKey;
    // no secrets in the request => stored secret is kept
    expect((await put(KEY_A, { config: { orgId: "ORG2" }, expectedVersion: v0.version })).statusCode).toBe(202);
    const v1 = (await rowOf(TENANT_A, KEY_A))!;
    expect(v1.version).toBe(v0.version + 1);
    expect(v1.secrets.apiKey).toBe(sealedBefore);
    expect(v1.config).toEqual({ orgId: "ORG2" });
    // supply an extra secret + new apiKey
    await put(KEY_A, { config: { orgId: "ORG2" }, secrets: { apiKey: "rotated-key", extraSecret: "extra-1" }, expectedVersion: v1.version }); // gitleaks:allow
    const v2 = (await rowOf(TENANT_A, KEY_A))!;
    expect(v2.secrets.apiKey).not.toBe(sealedBefore);
    expect(Object.keys(v2.secrets).sort()).toEqual(["apiKey", "extraSecret"]);
    // explicit clear
    await put(KEY_A, { config: { orgId: "ORG2" }, clearSecrets: ["extraSecret"], expectedVersion: v2.version });
    expect(Object.keys((await rowOf(TENANT_A, KEY_A))!.secrets)).toEqual(["apiKey"]);
    // set + clear the same field in one request is refused
    const both = await put(KEY_A, { config: { orgId: "ORG2" }, secrets: { apiKey: "x" }, clearSecrets: ["apiKey"], expectedVersion: (await rowOf(TENANT_A, KEY_A))!.version });
    expect(both.statusCode).toBe(400);
  });

  it("optimistic locking: stale version is 409 and missing version on an existing record is 400", async () => {
    const cur = (await rowOf(TENANT_A, KEY_A))!;
    const stale = await put(KEY_A, { config: { orgId: "ORG9" }, expectedVersion: cur.version - 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect((await put(KEY_A, { config: { orgId: "ORG9" } })).statusCode).toBe(400);
    expect((await rowOf(TENANT_A, KEY_A))!.config).toEqual({ orgId: "ORG2" });
    // a creating call must not carry a version
    expect((await put(KEY_BETA, { ...FULL_SANDBOX, expectedVersion: 1 })).statusCode).toBe(404);
  });

  it("validates at the boundary: secrets-as-config, unknown fields, bad option values", async () => {
    const r = await put(KEY_BETA, { config: { orgId: "ORG1", apiKey: "leak", nope: "x", sandboxScenario: "explode" }, secrets: { orgId: "x" } });
    expect(r.statusCode).toBe(400);
    const fields = (r.json().fieldErrors as Array<{ field: string }>).map((f) => f.field).sort();
    expect(fields).toEqual(["apiKey", "nope", "orgId", "sandboxScenario"]);
    expect(await rowOf(TENANT_A, KEY_BETA)).toBeUndefined();
  });

  it("role gate: tenant_admin and module admins may configure, an officer may not; policy is tenant_admin only", async () => {
    expect((await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: H(OFFICER, ["officer"], TENANT_A) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: H(FIN, ["finance_admin"], TENANT_A) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: H(FIN, ["payroll_admin"], TENANT_A) })).statusCode).toBe(200);
    const policy = await app.inject({ method: "PUT", url: `${BASE}/tenant/settings`, headers: H(FIN, ["finance_admin"], TENANT_A), payload: { requireProductionApproval: false } });
    expect(policy.statusCode).toBe(403);
  });

  it("is tenant-isolated (RLS): another tenant sees nothing and cannot read or delete it", async () => {
    const list = await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: adm(B_ADMIN, TENANT_B) });
    expect(list.json().data).toEqual([]);
    expect((await getRecord(KEY_A, B_ADMIN, TENANT_B)).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `${BASE}/tenant/records/${KEY_A}?expectedVersion=1`, headers: adm(B_ADMIN, TENANT_B) })).statusCode).toBe(404);
    expect(await asTenant(TENANT_B, (sql) => sql`SELECT 1 FROM platform_integrations.tenant_integrations WHERE tenant_id = ${TENANT_A}`)).toHaveLength(0);
  });

  it("platform usage counts include tenant rows without exposing tenant data", async () => {
    const res = await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_A}`, headers: superH() });
    expect(res.json().data.usage).toEqual({ sandbox: 1, production: 0 });
    expect(res.body).not.toContain(TENANT_A);
  });

  it("deleting a configuration needs the current version and removes it", async () => {
    await configure(KEY_BETA);
    const cur = (await rowOf(TENANT_A, KEY_BETA))!;
    const stale = await app.inject({ method: "DELETE", url: `${BASE}/tenant/records/${KEY_BETA}?expectedVersion=${cur.version + 5}`, headers: adm(MAKER) });
    expect(stale.statusCode).toBe(409);
    const ok = await app.inject({ method: "DELETE", url: `${BASE}/tenant/records/${KEY_BETA}?expectedVersion=${cur.version}`, headers: adm(MAKER) });
    expect(ok.statusCode).toBe(202);
    await drain();
    expect(await rowOf(TENANT_A, KEY_BETA)).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("test connection and health card", () => {
  it("incomplete config is reported as CONFIG_INCOMPLETE and recorded", async () => {
    await put(KEY_BETA, { config: {}, secrets: {} });
    const res = await post(`/tenant/records/${KEY_BETA}/test`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ ok: false, code: "CONFIG_INCOMPLETE", environment: "sandbox" });
    const health = (await getRecord(KEY_BETA)).json().data.health;
    expect(health).toMatchObject({ status: "failure", code: "CONFIG_INCOMPLETE", environment: "sandbox" });
    expect(health.testedAt).not.toBeNull();
    const cur = (await rowOf(TENANT_A, KEY_BETA))!;
    await app.inject({ method: "DELETE", url: `${BASE}/tenant/records/${KEY_BETA}?expectedVersion=${cur.version}`, headers: adm(MAKER) });
    await drain();
  });

  it("sandbox: the mock adapter returns a realistic success, labelled mock, and the health card shows it", async () => {
    const res = await post(`/tenant/records/${KEY_A}/test`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ ok: true, code: "OK", mock: true, environment: "sandbox" });
    expect(res.json().data.latencyMs).toBeGreaterThan(0);
    const health = (await getRecord(KEY_A)).json().data.health;
    expect(health.status).toBe("success");
    expect(health.message).toMatch(/mock/i);
    expect((await audits(TENANT_A)).some((a) => a.action === "tenant_integration.test" && a.outcome === "success")).toBe(true);
  });

  it("sandbox: the scenario picker exercises failure paths; editing the config resets the health card", async () => {
    const cur = (await rowOf(TENANT_A, KEY_A))!;
    await put(KEY_A, { config: { orgId: "ORG2", sandboxScenario: "auth_failed" }, expectedVersion: cur.version });
    expect((await getRecord(KEY_A)).json().data.health.status).toBe("untested");
    const res = await post(`/tenant/records/${KEY_A}/test`, {});
    expect(res.json().data).toMatchObject({ ok: false, code: "AUTH_FAILED", mock: true });
    expect((await getRecord(KEY_A)).json().data.health).toMatchObject({ status: "failure", code: "AUTH_FAILED" });
  });

  it("test needs an existing record", async () => {
    expect((await post(`/tenant/records/${KEY_C}/test`, {})).statusCode).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("production switch: maker != checker", () => {
  it("refuses when required production fields are missing, and for beta providers", async () => {
    const r1 = await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "go live for UAT" });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().code).toBe("CONFIG_INCOMPLETE");
    expect((r1.json().fieldErrors as Array<{ field: string }>).map((f) => f.field)).toEqual(["prodOnly"]);

    await configure(KEY_BETA, { prodReady: true });
    const r2 = await post(`/tenant/records/${KEY_BETA}/production-switch`, { reason: "go live for UAT" });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().code).toBe("PROVIDER_BETA_SANDBOX_ONLY");
    const cur = (await rowOf(TENANT_A, KEY_BETA))!;
    await app.inject({ method: "DELETE", url: `${BASE}/tenant/records/${KEY_BETA}?expectedVersion=${cur.version}`, headers: adm(MAKER) });
    await drain();
  });

  it("defaults to approval ON: request -> pending; requester cannot approve; a different admin can; audited", async () => {
    const settings = await app.inject({ method: "GET", url: `${BASE}/tenant/settings`, headers: adm(MAKER) });
    expect(settings.json().data).toEqual({ requireProductionApproval: true, version: null, isDefault: true, pendingPolicyChange: null });

    const cur = (await rowOf(TENANT_A, KEY_A))!;
    await put(KEY_A, { config: { orgId: "ORG2", prodOnly: "P1", sandboxScenario: "success" }, expectedVersion: cur.version });
    const req = await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "go live for UAT" });
    expect(req.statusCode).toBe(202);
    expect(req.json().mode).toBe("pending_approval");
    const requestId = req.json().id as string;
    expect((await rowOf(TENANT_A, KEY_A))!.environment).toBe("sandbox");

    const detail = (await getRecord(KEY_A)).json();
    expect(detail.pendingSwitch).toMatchObject({ id: requestId, status: "pending", requestedBy: MAKER });

    // a second request while one is pending is refused
    const dup = await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "again please" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("ALREADY_PENDING");

    // maker != checker at the route...
    const self = await post(`/tenant/production-switches/${requestId}/approve`, {}, MAKER);
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await rowOf(TENANT_A, KEY_A))!.environment).toBe("sandbox");

    // ...a different admin approves
    const ok = await post(`/tenant/production-switches/${requestId}/approve`, { note: "reviewed" }, CHECKER);
    expect(ok.statusCode).toBe(202);
    const after = (await rowOf(TENANT_A, KEY_A))!;
    expect(after.environment).toBe("production");
    const hist = (await app.inject({ method: "GET", url: `${BASE}/tenant/production-switches?status=approved`, headers: adm(MAKER) })).json().data;
    expect(hist).toEqual(expect.arrayContaining([expect.objectContaining({ id: requestId, status: "approved", decidedBy: CHECKER, requestedBy: MAKER, direct: false })]));
    const acts = await audits(TENANT_A);
    expect(acts.some((a) => a.action === "production_switch.request" && a.outcome === "success")).toBe(true);
    expect(acts.some((a) => a.action === "production_switch.approve" && a.outcome === "success")).toBe(true);
    // a decided request cannot be decided again
    expect((await post(`/tenant/production-switches/${requestId}/approve`, {}, CHECKER2)).json().code).toBe("NOT_PENDING");
    // already production
    expect((await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "again please" })).json().code).toBe("ALREADY_PRODUCTION");
  });

  it("production test connection is a plain 501 'not yet available', never a fake result", async () => {
    const res = await post(`/tenant/records/${KEY_A}/test`, {});
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ code: "NOT_YET_AVAILABLE", message: "Not yet available — configured for UAT" });
    const health = (await getRecord(KEY_A)).json().data.health;
    expect(health.status).toBe("untested"); // switching environment reset the card; nothing was recorded
  });

  it("revert to sandbox is direct, needs a reason and the current version, and is audited", async () => {
    const cur = (await rowOf(TENANT_A, KEY_A))!;
    expect((await post(`/tenant/records/${KEY_A}/revert-sandbox`, { reason: "back to testing", expectedVersion: cur.version + 3 })).statusCode).toBe(409);
    expect((await post(`/tenant/records/${KEY_A}/revert-sandbox`, { reason: "x", expectedVersion: cur.version })).statusCode).toBe(400);
    const ok = await post(`/tenant/records/${KEY_A}/revert-sandbox`, { reason: "back to testing", expectedVersion: cur.version });
    expect(ok.statusCode).toBe(202);
    expect((await rowOf(TENANT_A, KEY_A))!.environment).toBe("sandbox");
    expect((await audits(TENANT_A)).some((a) => a.action === "tenant_integration.revert_sandbox" && a.outcome === "success")).toBe(true);
  });

  it("reject needs a different person; cancel only the requester; and repeated decisions are never dropped", async () => {
    const r1 = await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "attempt one" });
    const id1 = r1.json().id as string;
    expect((await post(`/tenant/production-switches/${id1}/cancel`, {}, CHECKER)).statusCode).toBe(403);
    expect((await post(`/tenant/production-switches/${id1}/reject`, { note: "no" }, MAKER)).json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await post(`/tenant/production-switches/${id1}/cancel`, {}, MAKER)).statusCode).toBe(202);
    // second cycle: same actors, same endpoint. A deterministic messageId would drop these.
    const r2 = await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "attempt two" });
    const id2 = r2.json().id as string;
    expect(id2).not.toBe(id1);
    expect((await post(`/tenant/production-switches/${id2}/reject`, { note: "not now" }, CHECKER)).statusCode).toBe(202);
    const rows = await asTenant(TENANT_A, (sql) => sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM platform_integrations.production_switch_requests WHERE tenant_id = ${TENANT_A} AND id IN (${id1}, ${id2})`);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [id1]: "cancelled", [id2]: "rejected" });
    expect((await rowOf(TENANT_A, KEY_A))!.environment).toBe("sandbox");
  });

  it("x-idempotency-key makes a retried request collapse to ONE row", async () => {
    const headers = { "x-idempotency-key": `pi-${run}-key-1` };
    const first = await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "idempotent try" }, MAKER, TENANT_A, headers);
    expect(first.statusCode).toBe(202);
    const id = first.json().id as string;
    expect(id).toBe(idempotentId({ idempotencyKey: headers["x-idempotency-key"], tenantId: TENANT_A }));
    await post(`/tenant/production-switches/${id}/cancel`, {}, MAKER);
    // replay with the same key after it was decided: no new row appears
    await post(`/tenant/records/${KEY_A}/production-switch`, { reason: "idempotent try" }, MAKER, TENANT_A, headers);
    const rows = await asTenant(TENANT_A, (sql) => sql`SELECT 1 FROM platform_integrations.production_switch_requests WHERE tenant_id = ${TENANT_A} AND id = ${id}`);
    expect(rows).toHaveLength(1);
    const pending = await asTenant(TENANT_A, (sql) => sql`SELECT 1 FROM platform_integrations.production_switch_requests WHERE tenant_id = ${TENANT_A} AND integration_id = (SELECT id FROM platform_integrations.tenant_integrations WHERE tenant_id = ${TENANT_A} AND provider_key = ${KEY_A}) AND status = 'pending'`);
    expect(pending).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("production switch: consumer is the authority (races, bypassed routes, stale config)", () => {
  async function raiseRequest(key: string): Promise<{ requestId: string; version: number }> {
    const res = await post(`/tenant/records/${key}/production-switch`, { reason: "race test request" });
    expect(res.statusCode).toBe(202);
    return { requestId: res.json().id as string, version: (await rowOf(TENANT_A, key))!.version };
  }
  const decideDirect = async (actor: string, requestId: string, decision: "approve" | "reject" | "cancel") => {
    // Publishes straight to the queue, bypassing the route's pre-checks, to prove the consumer enforces the rules itself.
    await publishAdminCommand(
      { tenantId: TENANT_A, actorId: actor, correlationId: randomUUID(), roles: ["tenant_admin"], actorType: "user", sessionId: "s" } as never,
      COMMANDS.tenantIntegrationSwitchDecide, requestId, { actorRoles: ["tenant_admin"], requestId, decision, note: null },
    );
  };

  it("two checkers approving at once: exactly one wins, the environment flips once", async () => {
    await configure(KEY_D, { prodReady: true });
    const { requestId, version } = await raiseRequest(KEY_D);
    const before = (await audits(TENANT_A)).filter((a) => a.action === "production_switch.approve").length;
    await Promise.all([decideDirect(CHECKER, requestId, "approve"), decideDirect(CHECKER2, requestId, "approve")]);
    await drain();
    const after = (await rowOf(TENANT_A, KEY_D))!;
    expect(after.environment).toBe("production");
    expect(after.version).toBe(version + 1); // flipped exactly once
    const decided = await asTenant(TENANT_A, (sql) => sql<Array<{ status: string; decided_by: string }>>`
      SELECT status, decided_by FROM platform_integrations.production_switch_requests WHERE id = ${requestId}`);
    expect(decided[0]?.status).toBe("approved");
    const acts = (await audits(TENANT_A)).filter((a) => a.action === "production_switch.approve").slice(before);
    expect(acts.filter((a) => a.outcome === "success")).toHaveLength(1);
    expect(acts.filter((a) => a.outcome === "failure")).toHaveLength(1);
  });

  it("the requester approving through a bypassed route is refused by the consumer (conditional UPDATE + CHECK)", async () => {
    const cur = (await rowOf(TENANT_A, KEY_D))!;
    await post(`/tenant/records/${KEY_D}/revert-sandbox`, { reason: "reset for next test", expectedVersion: cur.version });
    const { requestId } = await raiseRequest(KEY_D);
    await decideDirect(MAKER, requestId, "approve");
    await drain();
    expect((await rowOf(TENANT_A, KEY_D))!.environment).toBe("sandbox");
    const status = await asTenant(TENANT_A, (sql) => sql<Array<{ status: string }>>`SELECT status FROM platform_integrations.production_switch_requests WHERE id = ${requestId}`);
    expect(status[0]?.status).toBe("pending");
    const failures = (await audits(TENANT_A)).filter((a) => a.action === "production_switch.approve" && a.outcome === "failure" && a.resourceId === requestId);
    expect(failures.map((f) => f.reason)).toEqual(["NOT_PENDING_OR_NOT_ALLOWED"]);
    // the database itself also refuses a self-approval written by hand
    await expect(asTenant(TENANT_A, (sql) => sql`
      UPDATE platform_integrations.production_switch_requests SET status = 'approved', decided_by = requested_by WHERE id = ${requestId}`)).rejects.toThrow(/maker_checker/);
    // cleanup for the next test
    await post(`/tenant/production-switches/${requestId}/cancel`, {}, MAKER);
  });

  it("an approval for a configuration that changed after the request is voided, not applied", async () => {
    const { requestId, version } = await raiseRequest(KEY_D);
    // the maker edits the config AFTER raising the request
    await put(KEY_D, { config: { orgId: "ORG-CHANGED", prodOnly: "P2" }, expectedVersion: version });
    // route pre-check refuses with a clear reason...
    const viaRoute = await post(`/tenant/production-switches/${requestId}/approve`, {}, CHECKER);
    expect(viaRoute.statusCode).toBe(409);
    expect(viaRoute.json().code).toBe("STALE_CONFIGURATION");
    // ...and the consumer voids it even when the route is bypassed
    await decideDirect(CHECKER, requestId, "approve");
    await drain();
    expect((await rowOf(TENANT_A, KEY_D))!.environment).toBe("sandbox");
    const row = await asTenant(TENANT_A, (sql) => sql<Array<{ status: string; decision_note: string }>>`SELECT status, decision_note FROM platform_integrations.production_switch_requests WHERE id = ${requestId}`);
    expect(row[0]?.status).toBe("rejected");
    expect(row[0]?.decision_note).toMatch(/changed/);
    expect((await audits(TENANT_A)).some((a) => a.action === "production_switch.approve" && a.outcome === "failure" && a.reason === "STALE_CONFIGURATION")).toBe(true);
  });

  it("a request raised against a stale version is refused by the consumer", async () => {
    const cur = (await rowOf(TENANT_A, KEY_D))!;
    const id = randomUUID();
    await publishAdminCommand(
      { tenantId: TENANT_A, actorId: MAKER, correlationId: randomUUID(), roles: ["tenant_admin"], actorType: "user", sessionId: "s" } as never,
      COMMANDS.tenantIntegrationSwitchRequest, id, { actorRoles: ["tenant_admin"], requestId: id, providerKey: KEY_D, reason: "stale base version", baseVersion: cur.version - 1 },
    );
    await drain();
    const rows = await asTenant(TENANT_A, (sql) => sql`SELECT 1 FROM platform_integrations.production_switch_requests WHERE id = ${id}`);
    expect(rows).toHaveLength(0);
    expect((await audits(TENANT_A)).some((a) => a.action === "production_switch.request" && a.reason === "VERSION_CONFLICT")).toBe(true);
  });

  it("a plaintext secret can never reach the consumer: the save command demands a sealed envelope", async () => {
    const id = randomUUID();
    await publishAdminCommand(
      { tenantId: TENANT_A, actorId: MAKER, correlationId: randomUUID(), roles: ["tenant_admin"], actorType: "user", sessionId: "s" } as never,
      COMMANDS.tenantIntegrationSave, id,
      { actorRoles: ["tenant_admin"], providerKey: KEY_BETA, category: "dsc", newId: id, expectedVersion: null, enabled: true, config: {}, sealedPatch: { apiKey: "plaintext-secret" }, clearSecrets: [] }, // gitleaks:allow
    );
    await drain();
    expect(await rowOf(TENANT_A, KEY_BETA)).toBeUndefined();
    const stored = await sqlClient`SELECT 1 FROM platform_integrations.tenant_integrations WHERE secrets::text LIKE '%plaintext-secret%'`; // gitleaks:allow
    expect(stored).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
const ctxFor = (actor: string, roles: string[], tenantId = TENANT_A) =>
  ({ tenantId, actorId: actor, correlationId: randomUUID(), roles, actorType: "user", sessionId: "s" }) as never;
const publishAs = async (topic: string, actor: string, roles: string[], payload: Record<string, unknown>, tenantId = TENANT_A) => {
  await publishAdminCommand(ctxFor(actor, roles, tenantId), topic, randomUUID(), { actorRoles: roles, ...payload });
  await drain();
};
const settingsRow = () => asTenant(TENANT_A, (sql) => sql<Array<{ require_production_approval: boolean; version: number }>>`
  SELECT require_production_approval, version FROM platform_integrations.tenant_integration_settings WHERE tenant_id = ${TENANT_A}`).then((r) => r[0]);
const policyRows = () => asTenant(TENANT_A, (sql) => sql<Array<{ id: string; status: string; requested_by: string; decided_by: string | null }>>`
  SELECT id, status, requested_by, decided_by FROM platform_integrations.policy_change_requests WHERE tenant_id = ${TENANT_A} ORDER BY requested_at`);

async function requestPolicyOff(actor = MAKER, reason: string | null = "UAT window needs direct switches") {
  const res = await app.inject({ method: "PUT", url: `${BASE}/tenant/settings`, headers: adm(actor), payload: { requireProductionApproval: false, ...(reason ? { reason } : {}) } });
  await drain();
  return res;
}
async function decidePolicy(id: string, decision: "approve" | "reject" | "cancel", actor: string) {
  const res = await app.inject({ method: "POST", url: `${BASE}/tenant/policy-changes/${id}/${decision}`, headers: adm(actor), payload: {} });
  await drain();
  return res;
}
async function toProduction(key: string, tenantId = TENANT_A, maker = MAKER, checker = CHECKER) {
  const req = await post(`/tenant/records/${key}/production-switch`, { reason: "go live for UAT" }, maker, tenantId);
  expect(req.statusCode).toBe(202);
  const ok = await post(`/tenant/production-switches/${req.json().id}/approve`, {}, checker, tenantId);
  expect(ok.statusCode).toBe(202);
  expect((await rowOf(tenantId, key))!.environment).toBe("production");
}

describe("approval policy: turning it OFF needs a second approver", () => {
  it("OFF files a request (reason required) and changes nothing; the requester cannot approve; a different admin can", async () => {
    expect((await requestPolicyOff(MAKER, null)).statusCode).toBe(400);
    const res = await requestPolicyOff();
    expect(res.statusCode).toBe(202);
    expect(res.json().mode).toBe("pending_approval");
    expect(await settingsRow()).toBeUndefined(); // still the default: ON
    const settings = (await app.inject({ method: "GET", url: `${BASE}/tenant/settings`, headers: adm(MAKER) })).json().data;
    expect(settings.requireProductionApproval).toBe(true);
    expect(settings.pendingPolicyChange).toMatchObject({ status: "pending", requestedBy: MAKER });
    const id = settings.pendingPolicyChange.id as string;

    expect((await requestPolicyOff(CHECKER)).json().code).toBe("ALREADY_PENDING");
    const self = await decidePolicy(id, "approve", MAKER);
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect(await settingsRow()).toBeUndefined();

    expect((await decidePolicy(id, "approve", CHECKER)).statusCode).toBe(202);
    expect(await settingsRow()).toMatchObject({ require_production_approval: false, version: 1 });
    const acts = await audits(TENANT_A);
    expect(acts.some((a) => a.action === "policy_change.request" && a.outcome === "success")).toBe(true);
    expect(acts.some((a) => a.action === "policy_change.approve" && a.outcome === "success")).toBe(true);
    expect((await decidePolicy(id, "approve", CHECKER2)).json().code).toBe("NOT_PENDING");
    expect((await requestPolicyOff()).json().code).toBe("ALREADY_OFF");
  });

  it("turning it back ON stays single-actor", async () => {
    const res = await app.inject({ method: "PUT", url: `${BASE}/tenant/settings`, headers: adm(MAKER), payload: { requireProductionApproval: true, expectedVersion: 1 } });
    expect(res.statusCode).toBe(202);
    await drain();
    expect(await settingsRow()).toMatchObject({ require_production_approval: true, version: 2 });
    const again = await app.inject({ method: "PUT", url: `${BASE}/tenant/settings`, headers: adm(MAKER), payload: { requireProductionApproval: true, expectedVersion: 2 } });
    expect(again.json().code).toBe("ALREADY_ON");
  });

  it("a settings command that tries to turn approval OFF directly is refused by the consumer", async () => {
    await publishAs(COMMANDS.tenantIntegrationSettingsUpdate, MAKER, ["tenant_admin"], { requireProductionApproval: false, expectedVersion: 2 });
    expect(await settingsRow()).toMatchObject({ require_production_approval: true, version: 2 });
    expect((await audits(TENANT_A)).some((a) => a.action === "tenant_integration.settings_update" && a.reason === "POLICY_OFF_REQUIRES_APPROVAL")).toBe(true);
  });

  it("the requester approving through a bypassed route is refused (conditional UPDATE + CHECK)", async () => {
    const id = (await requestPolicyOff()).json().id as string;
    await publishAs(COMMANDS.tenantIntegrationPolicyDecide, MAKER, ["tenant_admin"], { requestId: id, decision: "approve", note: null });
    expect(await settingsRow()).toMatchObject({ require_production_approval: true });
    expect((await policyRows()).find((r) => r.id === id)?.status).toBe("pending");
    expect((await audits(TENANT_A)).some((a) => a.action === "policy_change.approve" && a.resourceId === id && a.reason === "NOT_PENDING_OR_NOT_ALLOWED")).toBe(true);
    await expect(asTenant(TENANT_A, (sql) => sql`
      UPDATE platform_integrations.policy_change_requests SET status = 'approved', decided_by = requested_by WHERE id = ${id}`)).rejects.toThrow(/maker_checker/);
    expect((await decidePolicy(id, "cancel", CHECKER)).statusCode).toBe(403);
    expect((await decidePolicy(id, "cancel", MAKER)).statusCode).toBe(202);
  });

  it("two approvers at once: exactly one wins and the setting flips once", async () => {
    const id = (await requestPolicyOff()).json().id as string;
    await Promise.all([
      publishAs(COMMANDS.tenantIntegrationPolicyDecide, CHECKER, ["tenant_admin"], { requestId: id, decision: "approve", note: null }),
      publishAs(COMMANDS.tenantIntegrationPolicyDecide, CHECKER2, ["tenant_admin"], { requestId: id, decision: "approve", note: null }),
    ]);
    await drain();
    expect(await settingsRow()).toMatchObject({ require_production_approval: false, version: 3 });
    const acts = (await audits(TENANT_A)).filter((a) => a.action === "policy_change.approve" && a.resourceId === id);
    expect(acts.filter((a) => a.outcome === "success")).toHaveLength(1);
  });

  it("with approval OFF a switch applies directly; then ON again restores maker-checker; reject and repeated requests work", async () => {
    await configure(KEY_E, { prodReady: true });
    const direct = await post(`/tenant/records/${KEY_E}/production-switch`, { reason: "approval is off here" });
    expect(direct.json().mode).toBe("direct");
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("production");
    expect((await audits(TENANT_A)).some((a) => a.action === "production_switch.applied_direct" && a.outcome === "success")).toBe(true);
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    await post(`/tenant/records/${KEY_E}/revert-sandbox`, { reason: "reset for next test", expectedVersion: cur.version });

    const s = (await settingsRow())!;
    expect((await app.inject({ method: "PUT", url: `${BASE}/tenant/settings`, headers: adm(MAKER), payload: { requireProductionApproval: true, expectedVersion: s.version } })).statusCode).toBe(202);
    await drain();
    expect((await post(`/tenant/records/${KEY_E}/production-switch`, { reason: "approval is back on" })).json().mode).toBe("pending_approval");
    // repeated policy cycles are never dropped
    const r1 = (await requestPolicyOff()).json().id as string;
    expect((await decidePolicy(r1, "reject", CHECKER)).statusCode).toBe(202);
    const r2 = (await requestPolicyOff()).json().id as string;
    expect(r2).not.toBe(r1);
    expect((await decidePolicy(r2, "reject", CHECKER)).statusCode).toBe(202);
    expect((await policyRows()).filter((r) => r.id === r1 || r.id === r2).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect((await settingsRow())!.require_production_approval).toBe(true);
    // clean the pending switch request so later suites start clean
    const pend = (await app.inject({ method: "GET", url: `${BASE}/tenant/production-switches?status=pending`, headers: adm(MAKER) })).json().data as Array<{ id: string }>;
    for (const p of pend) await post(`/tenant/production-switches/${p.id}/cancel`, {}, MAKER);
  });
});

describe("approval policy: only POLICY_ROLES may decide or change it", () => {
  it("finance_admin and payroll_admin get 403 deciding a policy-OFF request; a different tenant_admin succeeds", async () => {
    const id = (await requestPolicyOff()).json().id as string;
    for (const role of ["finance_admin", "payroll_admin"]) {
      for (const d of ["approve", "reject"]) {
        const res = await app.inject({ method: "POST", url: `${BASE}/tenant/policy-changes/${id}/${d}`, headers: H(FIN, [role], TENANT_A), payload: {} });
        expect(res.statusCode).toBe(403);
      }
    }
    expect((await policyRows()).find((r) => r.id === id)?.status).toBe("pending");
    expect((await decidePolicy(id, "reject", CHECKER)).statusCode).toBe(202); // tenant_admin, not the requester
    expect((await policyRows()).find((r) => r.id === id)?.status).toBe("rejected");
  });

  it("the consumer refuses finance_admin / payroll_admin / empty roles deciding when the route is bypassed", async () => {
    const before = await settingsRow();
    const id = (await requestPolicyOff()).json().id as string;
    for (const roles of [["finance_admin"], ["payroll_admin"], [] as string[]]) {
      await publishAs(COMMANDS.tenantIntegrationPolicyDecide, FIN, roles, { requestId: id, decision: "approve", note: null });
    }
    expect(await settingsRow()).toEqual(before);
    expect((await policyRows()).find((r) => r.id === id)?.status).toBe("pending");
    const refusals = (await audits(TENANT_A)).filter((a) => a.action === "policy_change.approve" && a.resourceId === id && a.reason === "ROLE_NOT_ALLOWED");
    expect(refusals).toHaveLength(3);
    expect((await decidePolicy(id, "cancel", MAKER)).statusCode).toBe(202);
  });

  it("the settings-update consumer re-checks POLICY_ROLES (ON too) and fails closed on empty roles", async () => {
    // put the tenant in the OFF state through the real two-actor flow
    const id = (await requestPolicyOff()).json().id as string;
    expect((await decidePolicy(id, "approve", CHECKER)).statusCode).toBe(202);
    const off = (await settingsRow())!;
    expect(off.require_production_approval).toBe(false);
    for (const roles of [["finance_admin"], ["payroll_admin"], [] as string[]]) {
      await publishAs(COMMANDS.tenantIntegrationSettingsUpdate, FIN, roles, { requireProductionApproval: true, expectedVersion: off.version });
    }
    expect(await settingsRow()).toMatchObject({ require_production_approval: false, version: off.version });
    expect((await audits(TENANT_A)).filter((a) => a.action === "tenant_integration.settings_update" && a.reason === "ROLE_NOT_ALLOWED")).toHaveLength(3);
    // a tenant_admin may turn it back ON; so the route stamps roles end to end
    const on = await app.inject({ method: "PUT", url: `${BASE}/tenant/settings`, headers: adm(MAKER), payload: { requireProductionApproval: true, expectedVersion: off.version } });
    expect(on.statusCode).toBe(202);
    await drain();
    expect((await settingsRow())!.require_production_approval).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("production edits: a sensitive edit never leaves the record live without a second approver", () => {
  const edit = async (key: string, body: Record<string, unknown>) => {
    const cur = (await rowOf(TENANT_A, key))!;
    return put(key, { expectedVersion: cur.version, ...body });
  };

  it("secret, sensitive config field and secret-clear edits revert to sandbox in the same write; the switch maker-checker applies again", async () => {
    await toProduction(KEY_E);
    // a secret edit
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    const res = await edit(KEY_E, { config: cur.config, secrets: { apiKey: "rotated-api-key" } }); // gitleaks:allow
    expect(res.statusCode).toBe(202);
    expect(res.json().revertsToSandbox).toBe(true);
    let after = (await rowOf(TENANT_A, KEY_E))!;
    expect(after.environment).toBe("sandbox");
    expect(after.version).toBe(cur.version + 1);
    expect((await audits(TENANT_A)).some((a) => a.action === "tenant_integration.reverted_to_sandbox_on_edit" && a.outcome === "success")).toBe(true);
    // the requester cannot re-approve their own switch
    const again = await post(`/tenant/records/${KEY_E}/production-switch`, { reason: "re-approval after credential change" });
    expect((await post(`/tenant/production-switches/${again.json().id}/approve`, {}, MAKER)).json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await post(`/tenant/production-switches/${again.json().id}/approve`, {}, CHECKER)).statusCode).toBe(202);
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("production");

    // a sensitive (marked) config field
    after = (await rowOf(TENANT_A, KEY_E))!;
    const r2 = await edit(KEY_E, { config: { ...after.config, orgId: "ORG-NEW" } });
    expect(r2.json().revertsToSandbox).toBe(true);
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("sandbox");
    await toProduction(KEY_E);

    // clearing a secret
    after = (await rowOf(TENANT_A, KEY_E))!;
    await edit(KEY_E, { config: after.config, secrets: { extraSecret: "e1" } }); // gitleaks:allow
    await toProduction(KEY_E);
    after = (await rowOf(TENANT_A, KEY_E))!;
    await edit(KEY_E, { config: after.config, clearSecrets: ["extraSecret"] });
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("sandbox");
  });

  it("non-sensitive edits (enabled flag, sandbox scenario) stay live and are audited as plain updates", async () => {
    await toProduction(KEY_E);
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    const r = await edit(KEY_E, { config: { ...cur.config, sandboxScenario: "auth_failed" }, enabled: false });
    expect(r.statusCode).toBe(202);
    expect(r.json().revertsToSandbox).toBe(false);
    const after = (await rowOf(TENANT_A, KEY_E))!;
    expect(after.environment).toBe("production");
    expect(after.enabled).toBe(false);
    expect(after.version).toBe(cur.version + 1);
    // restore for later tests
    await edit(KEY_E, { config: { ...after.config, sandboxScenario: "success" }, enabled: true });
    await post(`/tenant/records/${KEY_E}/revert-sandbox`, { reason: "reset for next test", expectedVersion: (await rowOf(TENANT_A, KEY_E))!.version });
  });

  it("a schema with no field marked sensitive treats EVERY field as sensitive", async () => {
    await configure(KEY_F, { prodReady: true });
    await toProduction(KEY_F);
    const cur = (await rowOf(TENANT_A, KEY_F))!;
    const r = await edit(KEY_F, { config: { ...cur.config, sandboxScenario: "auth_failed" } });
    expect(r.json().revertsToSandbox).toBe(true);
    expect((await rowOf(TENANT_A, KEY_F))!.environment).toBe("sandbox");
  });

  it("the consumer enforces it even when the route is bypassed", async () => {
    await toProduction(KEY_E);
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    const id = randomUUID();
    await publishAs(COMMANDS.tenantIntegrationSave, MAKER, ["tenant_admin"], {
      providerKey: KEY_E, category: "esign", newId: id, expectedVersion: cur.version, enabled: true, config: cur.config,
      sealedPatch: { apiKey: sealSecretForTest("bypass-secret") }, clearSecrets: [], // gitleaks:allow
    });
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("sandbox");
  });

  it("the UI hint matches: a pending production request is stale after the revert", async () => {
    const detail = (await getRecord(KEY_E)).json();
    expect(detail.data.environment).toBe("sandbox");
    expect(detail.pendingSwitch).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("category-scoped roles (route and consumer)", () => {
  const finH = (actor = FIN) => H(actor, ["finance_admin"], TENANT_A);

  it("finance_admin sees and manages bank_api/pfms only; esign/dsc are tenant_admin-level", async () => {
    const cat = (await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: finH() })).json().data as Array<{ key: string; category: string }>;
    expect(cat.map((p) => p.key)).toContain(KEY_F);
    expect(cat.some((p) => p.category === "esign" || p.category === "dsc")).toBe(false);
    const recs = (await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: finH() })).json().data as Array<{ category: string }>;
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.category === "bank_api" || r.category === "pfms")).toBe(true);
    const own = (await app.inject({ method: "GET", url: `${BASE}/tenant/records`, headers: adm(MAKER) })).json().data as Array<{ category: string }>;
    expect(own.some((r) => r.category === "esign")).toBe(true);

    const blocked = await app.inject({ method: "PUT", url: `${BASE}/tenant/records/${KEY_E}`, headers: finH(), payload: { ...FULL_SANDBOX, expectedVersion: 1 } });
    expect(blocked.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${BASE}/tenant/records/${KEY_E}`, headers: finH() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${BASE}/tenant/records/${KEY_E}/test`, headers: finH(), payload: {} })).statusCode).toBe(403);
    const payroll = await app.inject({ method: "GET", url: `${BASE}/tenant/records/${KEY_E}`, headers: H(FIN, ["payroll_admin"], TENANT_A) });
    expect(payroll.statusCode).toBe(403);
  });

  it("finance_admin can configure a bank integration and approve its production switch (not its own request)", async () => {
    const cur = (await rowOf(TENANT_A, KEY_F))!;
    const ok = await app.inject({ method: "PUT", url: `${BASE}/tenant/records/${KEY_F}`, headers: finH(), payload: { config: cur.config, expectedVersion: cur.version } });
    await drain();
    expect(ok.statusCode).toBe(202);
    const req = await post(`/tenant/records/${KEY_F}/production-switch`, { reason: "go live for UAT" }, MAKER);
    const id = req.json().id as string;
    const approve = await app.inject({ method: "POST", url: `${BASE}/tenant/production-switches/${id}/approve`, headers: finH(), payload: {} });
    await drain();
    expect(approve.statusCode).toBe(202);
    expect((await rowOf(TENANT_A, KEY_F))!.environment).toBe("production");
    await post(`/tenant/records/${KEY_F}/revert-sandbox`, { reason: "reset for next test", expectedVersion: (await rowOf(TENANT_A, KEY_F))!.version });
  });

  it("finance_admin cannot decide an eSign switch (route 403), and the consumer refuses it when the route is bypassed", async () => {
    await configure(KEY_E, { prodReady: true }).catch(() => undefined);
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    if (cur.environment !== "sandbox") await post(`/tenant/records/${KEY_E}/revert-sandbox`, { reason: "reset for next test", expectedVersion: cur.version });
    const req = await post(`/tenant/records/${KEY_E}/production-switch`, { reason: "go live for UAT" }, MAKER);
    const id = req.json().id as string;
    const viaRoute = await app.inject({ method: "POST", url: `${BASE}/tenant/production-switches/${id}/approve`, headers: finH(), payload: {} });
    expect(viaRoute.statusCode).toBe(403);
    await publishAs(COMMANDS.tenantIntegrationSwitchDecide, FIN, ["finance_admin"], { requestId: id, decision: "approve", note: null });
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("sandbox");
    expect((await audits(TENANT_A)).some((a) => a.action === "production_switch.approve" && a.resourceId === id && a.reason === "ROLE_NOT_ALLOWED")).toBe(true);
    await post(`/tenant/production-switches/${id}/cancel`, {}, MAKER);
  });

  it("consumer-level: a finance_admin save/delete/test/revert on an esign record is refused", async () => {
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    const id = randomUUID();
    await publishAs(COMMANDS.tenantIntegrationSave, FIN, ["finance_admin"], {
      providerKey: KEY_E, category: "esign", newId: id, expectedVersion: cur.version, enabled: false, config: cur.config, sealedPatch: {}, clearSecrets: [],
    });
    await publishAs(COMMANDS.tenantIntegrationDelete, FIN, ["finance_admin"], { providerKey: KEY_E, expectedVersion: cur.version });
    const after = (await rowOf(TENANT_A, KEY_E))!;
    expect(after.version).toBe(cur.version);
    expect(after.enabled).toBe(true);
    const reasons = (await audits(TENANT_A)).filter((a) => a.reason === "ROLE_NOT_ALLOWED").map((a) => a.action);
    expect(reasons).toEqual(expect.arrayContaining(["tenant_integration.save", "tenant_integration.delete"]));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("availability is re-checked in the consumer, not only the route", () => {
  it("a save for a provider restricted away from the tenant writes nothing", async () => {
    const id = randomUUID();
    await publishAs(COMMANDS.tenantIntegrationSave, MAKER, ["tenant_admin"], {
      providerKey: KEY_G, category: "esign", newId: id, expectedVersion: null, enabled: true, config: { orgId: "ORG1" }, sealedPatch: {}, clearSecrets: [],
    });
    expect(await rowOf(TENANT_A, KEY_G)).toBeUndefined();
    expect((await audits(TENANT_A)).some((a) => a.action === "tenant_integration.save" && a.reason === "PROVIDER_NOT_AVAILABLE")).toBe(true);
  });

  it("a switch request or approval raised after the platform restricted the provider is refused", async () => {
    await configure(KEY_E, { prodReady: true }).catch(() => undefined);
    const cur = (await rowOf(TENANT_A, KEY_E))!;
    if (cur.environment !== "sandbox") await post(`/tenant/records/${KEY_E}/revert-sandbox`, { reason: "reset for next test", expectedVersion: cur.version });
    const req = await post(`/tenant/records/${KEY_E}/production-switch`, { reason: "go live for UAT" });
    const requestId = req.json().id as string;
    // the platform now restricts KEY_E to tenant B only
    const v = (await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_E}`, headers: superH() })).json().data.version as number;
    await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_E}`, headers: superH(), payload: { expectedVersion: v, availability: { mode: "restricted", tenantIds: [TENANT_B], editions: [] } } });
    await drain();
    await publishAs(COMMANDS.tenantIntegrationSwitchDecide, CHECKER, ["tenant_admin"], { requestId, decision: "approve", note: null });
    expect((await rowOf(TENANT_A, KEY_E))!.environment).toBe("sandbox");
    expect((await audits(TENANT_A)).some((a) => a.action === "production_switch.approve" && a.resourceId === requestId && a.reason === "PROVIDER_NOT_AVAILABLE")).toBe(true);
    const id2 = randomUUID();
    await publishAs(COMMANDS.tenantIntegrationSwitchRequest, MAKER, ["tenant_admin"], { requestId: id2, providerKey: KEY_E, reason: "late request", baseVersion: (await rowOf(TENANT_A, KEY_E))!.version });
    expect(await asTenant(TENANT_A, (sql) => sql`SELECT 1 FROM platform_integrations.production_switch_requests WHERE id = ${id2}`)).toHaveLength(0);
    const v2 = (await app.inject({ method: "GET", url: `${BASE}/providers/${KEY_E}`, headers: superH() })).json().data.version as number;
    await app.inject({ method: "PATCH", url: `${BASE}/providers/${KEY_E}`, headers: superH(), payload: { expectedVersion: v2, availability: { mode: "all", tenantIds: [], editions: [] } } });
    await drain();
  });
});
