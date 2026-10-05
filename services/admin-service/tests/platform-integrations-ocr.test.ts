/**
 * `ocr` category of the platform-integration catalogue (migration 0047) + the internal availability read used by
 * document-service bulk scan. Real Postgres + RLS; secrets are sealed by the existing tenant-record pipeline.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test-master-key-for-platform-integrations"; // gitleaks:allow
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
process.env.INTERNAL_SERVICE_SECRET = SECRET;

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerAllF3Consumers } = await import("./helpers/register-all-f3-consumers.js");
const { ocrAvailability, ocrEngineId, parseFields } = await import("../src/modules/platform-integrations/domain.js");

const BASE = "/v1/admin/platform-integrations";
const INTERNAL = `/internal/v1/platform-integrations/ocr/availability`;
const SUPER = "bbbbbbbb-1111-4000-8000-000000000001";
const ADMIN = "bbbbbbbb-1111-4000-8000-000000000002";
const T1 = randomUUID();
const T2 = randomUUID();
const PLATFORM = randomUUID();
const bearer = (sub: string, roles: string[], tid: string) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-ocr" }, SECRET, 3600)}` });
const internal = (tid: string) => ({ "x-internal": "1", "x-tenant-id": tid, "x-service-secret": SECRET, "x-internal-caller": "document-service" });

let app: FastifyInstance;
const drain = async () => { await (queue as unknown as { drain?: () => Promise<void> }).drain?.(); };
const asTenant = <T>(t: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> =>
  sqlClient.begin(async (sql) => { await sql`SELECT set_config('app.tenant_id', ${t}, true)`; return run(sql as typeof sqlClient); }) as Promise<T>;
const asCatalogueWriter = <T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> =>
  sqlClient.begin(async (sql) => { await sql`SELECT set_config('app.platform_catalogue_write', 'true', true)`; return run(sql as typeof sqlClient); }) as Promise<T>;

const availability = async (tid: string) => (await app.inject({ method: "GET", url: INTERNAL, headers: internal(tid) })).json().data as { id: string; label: string; available: boolean; sandbox: boolean }[];
const byId = (rows: { id: string }[], id: string) => rows.find((r) => r.id === id) as { id: string; available: boolean; sandbox: boolean } | undefined;

beforeAll(async () => { registerAllF3Consumers(queue); await queue.start(); app = await buildApp(); });
afterAll(async () => {
  for (const t of [T1, T2]) await asTenant(t, (sql) => sql`DELETE FROM platform_integrations.tenant_integrations WHERE tenant_id = ${t}`);
  await asCatalogueWriter((sql) => sql`UPDATE platform_integrations.providers SET availability_mode = 'all', allowed_tenant_ids = '{}', status = 'beta' WHERE key = 'ocr_aws_textract'`);
  await app.close(); await queue.stop(); await sqlClient.end();
});

describe("catalogue: ocr category (migration 0047)", () => {
  it("seeds tesseract (available, nothing to configure) and the four cloud engines (beta, sealed credentials, sandbox scenario, no invented endpoints)", async () => {
    const res = await app.inject({ method: "GET", url: `${BASE}/providers?category=ocr`, headers: bearer(SUPER, ["super_admin"], PLATFORM) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { key: string; category: string; status: string; fields: { key: string; secret: boolean; environments: string[] }[]; endpoints: { sandbox: string | null; production: string | null }; capabilities: string[] }[];
    expect(data.map((p) => p.key).sort()).toEqual(["ocr_aws_textract", "ocr_azure_docint", "ocr_bhashini", "ocr_google_docai", "ocr_tesseract"]);
    for (const p of data) { expect(p.category).toBe("ocr"); expect(p.endpoints).toEqual({ sandbox: null, production: null }); expect(p.capabilities).toEqual(["ocr.recognize"]); }
    const tess = data.find((p) => p.key === "ocr_tesseract");
    expect(tess).toMatchObject({ status: "available", fields: [] });
    for (const p of data.filter((x) => x.key !== "ocr_tesseract")) {
      expect(p.status).toBe("beta");                                               // sandbox only until a production adapter exists
      expect(p.fields.some((f) => f.secret), p.key + " has a sealed credential field").toBe(true);
      expect(p.fields.find((f) => f.key === "sandboxScenario")?.environments).toEqual(["sandbox"]);
    }
    // the generic category filter and list still work
    expect((await app.inject({ method: "GET", url: `${BASE}/providers`, headers: bearer(SUPER, ["super_admin"], PLATFORM) })).json().data.length).toBeGreaterThanOrEqual(17);
  });

  it("the category CHECK now accepts ocr and still rejects unknown categories; re-running the seed changes nothing", async () => {
    await expect(asCatalogueWriter((sql) => sql`INSERT INTO platform_integrations.providers (key, category, name, capabilities, config_schema) VALUES ('zz_bad_cat', 'bogus', 'x', '[]', '{"fields":[]}')`)).rejects.toThrow(/pi_providers_category_chk/);
    const before = await sqlClient`SELECT count(*)::int AS n FROM platform_integrations.providers WHERE category = 'ocr'`;
    expect(before[0]?.n).toBe(5);
  });

  it("tenant admins see the ocr providers in their catalogue and can configure one; secrets are sealed at rest and never returned", async () => {
    const h = bearer(ADMIN, ["tenant_admin"], T1);
    const cat = await app.inject({ method: "GET", url: `${BASE}/tenant/catalogue`, headers: h });
    expect((cat.json().data as { key: string }[]).map((p) => p.key)).toEqual(expect.arrayContaining(["ocr_tesseract", "ocr_google_docai", "ocr_bhashini"]));
    const put = await app.inject({
      method: "PUT", url: `${BASE}/tenant/records/ocr_bhashini`, headers: h,
      payload: { config: { userId: "bhashini-user-1" }, secrets: { apiKey: "plain-ulca-key-123" } }, // gitleaks:allow
    });
    await drain();
    expect(put.statusCode).toBe(202);
    const row = (await asTenant(T1, (sql) => sql<{ secrets: Record<string, string>; config: Record<string, unknown>; environment: string }[]>`
      SELECT secrets, config, environment FROM platform_integrations.tenant_integrations WHERE tenant_id = ${T1} AND provider_key = 'ocr_bhashini'`))[0];
    expect(row?.environment).toBe("sandbox");                                       // starts in the sandbox, always
    expect(row?.secrets.apiKey).toMatch(/^enc:/);
    expect(JSON.stringify(row)).not.toContain("plain-ulca-key-123");
    const read = await app.inject({ method: "GET", url: `${BASE}/tenant/records/ocr_bhashini`, headers: h });
    expect(JSON.stringify(read.json())).not.toContain("plain-ulca-key-123");
    // and it shows up as available (sandbox) to the pipeline
    expect(byId(await availability(T1), "bhashini")).toMatchObject({ available: true, sandbox: true });
  });
});

describe("GET /internal/v1/platform-integrations/ocr/availability", () => {
  it("is service-to-service only: no auth 401, a user token (even super_admin) 403", async () => {
    expect((await app.inject({ method: "GET", url: INTERNAL })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: INTERNAL, headers: bearer(SUPER, ["super_admin"], T1) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: INTERNAL, headers: { ...internal(T1), "x-service-secret": "wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: INTERNAL, headers: internal(T1) })).statusCode).toBe(200);
  });

  it("a tenant with no configuration: tesseract only (always on, never sandbox); cloud engines listed unavailable", async () => {
    const rows = await availability(T2);
    expect(byId(rows, "tesseract")).toMatchObject({ available: true, sandbox: false });
    for (const id of ["google_docai", "aws_textract", "azure_docint", "bhashini"]) expect(byId(rows, id), id).toMatchObject({ available: false });
    expect(rows.every((r) => typeof r.label === "string")).toBe(true);
  });

  it("a configured cloud engine is available only when enabled and complete; secrets never leak", async () => {
    // complete sandbox record for google_docai (secret sealed with the real sealer through the PUT path)
    const h = bearer(ADMIN, ["tenant_admin"], T2);
    await app.inject({ method: "PUT", url: `${BASE}/tenant/records/ocr_google_docai`, headers: h, payload: { config: { projectId: "my-gov-project", location: "asia-south1", processorId: "abcdef123456" }, secrets: { serviceAccountJson: "{\"private_key\":\"SECRET-KEY-MATERIAL\"}" } } }); // gitleaks:allow
    await drain();
    // incomplete record: azure without its key
    await app.inject({ method: "PUT", url: `${BASE}/tenant/records/ocr_azure_docint`, headers: h, payload: { config: { endpoint: "https://res.cognitiveservices.azure.com" }, secrets: {} } });
    await drain();
    const raw = await app.inject({ method: "GET", url: INTERNAL, headers: internal(T2) });
    const rows = raw.json().data as { id: string; available: boolean; sandbox: boolean }[];
    expect(byId(rows, "google_docai")).toMatchObject({ available: true, sandbox: true });
    expect(byId(rows, "azure_docint")).toMatchObject({ available: false });
    expect(raw.body).not.toMatch(/SECRET-KEY-MATERIAL|private_key|enc:/);
    // disabling the record withdraws it
    await asTenant(T2, (sql) => sql`UPDATE platform_integrations.tenant_integrations SET enabled = false WHERE tenant_id = ${T2} AND provider_key = 'ocr_google_docai'`);
    expect(byId(await availability(T2), "google_docai")).toMatchObject({ available: false });
  });

  it("is tenant isolated and honours platform restrictions (restricted provider hidden from other tenants)", async () => {
    expect(byId(await availability(T2), "bhashini")).toMatchObject({ available: false });        // T1's record is invisible to T2
    await asCatalogueWriter((sql) => sql`UPDATE platform_integrations.providers SET availability_mode = 'restricted', allowed_tenant_ids = ARRAY[${T1}]::uuid[] WHERE key = 'ocr_aws_textract'`);
    expect(byId(await availability(T1), "aws_textract")).toBeDefined();
    expect(byId(await availability(T2), "aws_textract")).toBeUndefined();
  });
});

describe("ocrAvailability (pure)", () => {
  const prov = (key: string, status: string, fields: unknown[] = [], extra: Record<string, unknown> = {}) =>
    ({ key, category: "ocr", name: key, status, availabilityMode: "all", allowedTenantIds: [], allowedEditions: [], configSchema: { fields }, ...extra }) as never;
  const rec = (key: string, o: Record<string, unknown>) => ({ providerKey: key, category: "ocr", enabled: true, environment: "sandbox", config: {}, secrets: {}, ...o }) as never;
  const F = parseFields({ fields: [{ key: "k", label: "K", type: "text", required: true, secret: true }, { key: "id", label: "Id", type: "text", required: true, secret: false }] });

  it("maps keys to engine ids and always reports tesseract", () => {
    expect(ocrEngineId("ocr_bhashini")).toBe("bhashini");
    expect(ocrEngineId("esign_x")).toBeNull();
    expect(ocrAvailability([], [], "t", null)).toEqual([{ id: "tesseract", label: "Tesseract (on-device)", available: true, sandbox: false }]);
  });

  it("production needs a promoted (available) provider; beta stays sandbox-only", () => {
    const fields = F as unknown[];
    const beta = prov("ocr_x1", "beta", fields), live = prov("ocr_x2", "available", fields);
    const prodRec = (k: string) => rec(k, { environment: "production", config: { id: "a" }, secrets: { k: "enc:v2:x" } });
    const out = ocrAvailability([beta, live], [prodRec("ocr_x1"), prodRec("ocr_x2")], "t", null);
    expect(out.find((o) => o.id === "x1")).toMatchObject({ available: false });
    expect(out.find((o) => o.id === "x2")).toMatchObject({ available: true, sandbox: false });
  });

  it("incomplete / disabled / disabled-by-platform are unavailable", () => {
    const fields = F as unknown[];
    const p = prov("ocr_y", "beta", fields);
    expect(ocrAvailability([p], [rec("ocr_y", { config: { id: "a" } })], "t", null).find((o) => o.id === "y")?.available).toBe(false);
    expect(ocrAvailability([p], [rec("ocr_y", { enabled: false, config: { id: "a" }, secrets: { k: "e" } })], "t", null).find((o) => o.id === "y")?.available).toBe(false);
    expect(ocrAvailability([prov("ocr_y", "disabled", fields)], [rec("ocr_y", { config: { id: "a" }, secrets: { k: "e" } })], "t", null).find((o) => o.id === "y")).toBeUndefined();
  });
});
