/**
 * COMP-020: GET /v1/admin/editions | /entitlements | /gateways -- real Postgres, real RLS,
 * non-superuser role. Role-denied 403, cross-tenant platform reads, no secret leakage,
 * and the wire shape the /admin/* web screens parse.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import {
  gatewayStatus, toEditionView, toGatewayView, editionEntitlement, tenantOverride, GATEWAY_PROVIDERS,
} from "../src/modules/platform-catalogue/domain.js";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T_A = "cafe0020-0000-4000-8000-00000000000a";
const T_B = "cafe0020-0000-4000-8000-00000000000b";
const ACTOR = "cafe0020-0000-4000-8000-0000000000a1";
const SECRET_VALUE = globalThis.crypto.randomUUID();

const hdr = (tid: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-comp020" }, SECRET, 3600)}`,
});
const get = (url: string, tid: string, roles: string[], remoteAddress?: string) =>
  app.inject({ method: "GET", url, headers: hdr(tid, roles), ...(remoteAddress ? { remoteAddress } : {}) });

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const t of [T_A, T_B]) {
    await asTenant(t, (s) => s`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`);
    await asTenant(t, (s) => s`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`);
    await asTenant(t, (s) => s`DELETE FROM integration_settings.integration_settings WHERE tenant_id = ${t}`);
    await asTenant(t, (s) => s`DELETE FROM tenants.admin_tenants WHERE tenant_id = ${t}`);
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await asTenant(T_A, (s) => s`INSERT INTO tenants.admin_tenants (tenant_id, name, domain, edition, status, region, residency, created_by, updated_by)
    VALUES (${T_A}, 'Comp020 Dept A', 'a.comp020.gov.in', 'govt_dept', 'active', 'in-west', 'india', ${ACTOR}, ${ACTOR})`);
  await asTenant(T_B, (s) => s`INSERT INTO tenants.admin_tenants (tenant_id, name, domain, edition, status, region, residency, created_by, updated_by)
    VALUES (${T_B}, 'Comp020 PSU B', 'b.comp020.gov.in', 'psu', 'active', 'in-west', 'india', ${ACTOR}, ${ACTOR})`);
  // T_A: 'employee' is a govt_dept default (NOT an override), 'smarttransfer' is not (an override).
  await asTenant(T_A, (s) => s`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
    VALUES (${T_A}, 'employee', 'user', ${ACTOR}), (${T_A}, 'smarttransfer', 'user', ${ACTOR}), (${T_A}, 'identity', 'core', ${ACTOR})`);
  await asTenant(T_B, (s) => s`INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
    VALUES (${T_B}, 'smarttransfer', 'user', ${ACTOR})`);
  // SMS: T_A connected, T_B failed -> degraded. Email: T_A connected only. Push: disabled row -> not counted.
  await asTenant(T_A, (s) => s`INSERT INTO integration_settings.integration_settings
    (tenant_id, provider, env_scope, enabled, status, last_tested_at, secret_ciphertext, created_by, updated_by) VALUES
    (${T_A}, 'sms_twilio', 'prod', true, 'connected', now(), ${SECRET_VALUE}, ${ACTOR}, ${ACTOR}),
    (${T_A}, 'email_smtp', 'prod', true, 'connected', now(), ${SECRET_VALUE}, ${ACTOR}, ${ACTOR}),
    (${T_A}, 'push_fcm', 'prod', false, 'failed', now(), ${SECRET_VALUE}, ${ACTOR}, ${ACTOR})`);
  await asTenant(T_B, (s) => s`INSERT INTO integration_settings.integration_settings
    (tenant_id, provider, env_scope, enabled, status, last_tested_at, secret_ciphertext, created_by, updated_by) VALUES
    (${T_B}, 'sms_twilio', 'prod', true, 'failed', now(), ${SECRET_VALUE}, ${ACTOR}, ${ACTOR})`);
});
afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

const URLS = ["/v1/admin/editions", "/v1/admin/entitlements", "/v1/admin/gateways"];

describe("authorization", () => {
  for (const url of URLS) {
    it(`${url}: tenant_admin and an unrelated role get 403, unauthenticated 401`, async () => {
      expect((await get(url, T_A, ["tenant_admin"])).statusCode).toBe(403);
      expect((await get(url, T_A, ["hr_admin"])).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    });
    it(`${url}: super_admin and platform_admin are allowed`, async () => {
      expect((await get(url, T_A, ["super_admin"])).statusCode).toBe(200);
      expect((await get(url, T_B, ["platform_admin"])).statusCode).toBe(200);
    });
  }
});

describe("GET /v1/admin/editions", () => {
  it("lists the org profiles as editions with module counts, null pricing and platform-wide tenant counts", async () => {
    const res = await get("/v1/admin/editions", T_A, ["super_admin"]);
    const body = res.json();
    const govt = body.data.find((e: any) => e.code === "govt_dept");
    const psu = body.data.find((e: any) => e.code === "psu");
    expect(govt).toMatchObject({ name: "Government", status: "active", pricing: null });
    expect(govt.modulesIncluded).toBe(govt.modules.length);
    // Platform-wide: the caller (tenant A) also sees tenant B's PSU tenant, not just its own row.
    expect(govt.tenants).toBeGreaterThanOrEqual(1);
    expect(psu.tenants).toBeGreaterThanOrEqual(1);
    expect(typeof body.generatedAt).toBe("string");
    expect(body.total).toBe(body.data.length);
  });
  it("a tenant that applied another profile is counted under that profile", async () => {
    const before = (await get("/v1/admin/editions", T_A, ["super_admin"])).json().data;
    await asTenant(T_B, (s) => s`INSERT INTO composition.tenant_profile (tenant_id, profile_code, applied_by) VALUES (${T_B}, 'smarttransfer_standalone', ${ACTOR})`);
    const after = (await get("/v1/admin/editions", T_A, ["super_admin"])).json().data;
    const n = (rows: any[], c: string) => rows.find((e) => e.code === c).tenants;
    expect(n(after, "smarttransfer_standalone")).toBe(n(before, "smarttransfer_standalone") + 1);
    expect(n(after, "psu")).toBe(n(before, "psu") - 1);
    await asTenant(T_B, (s) => s`DELETE FROM composition.tenant_profile WHERE tenant_id = ${T_B}`);
  });
});

describe("GET /v1/admin/entitlements", () => {
  it("returns edition defaults plus cross-tenant overrides, excluding edition-granted and derived modules", async () => {
    const res = await get("/v1/admin/entitlements", T_B, ["platform_admin"]);
    const { data } = res.json();
    const mine = data.filter((r: any) => r.tenantId === T_A || r.tenantId === T_B);
    // Cross-tenant: caller is tenant B but sees tenant A's override too.
    expect(mine.map((r: any) => `${r.tenant}|${r.moduleId}`).sort()).toEqual([
      "Comp020 Dept A|smarttransfer",
      "Comp020 PSU B|smarttransfer",
    ]);
    expect(mine.every((r: any) => r.status === "active" && r.limit === "" && r.used === "")).toBe(true);
    const defaults = data.filter((r: any) => r.tenantId === null && r.edition === "govt_dept");
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.every((r: any) => r.tenant === "")).toBe(true);
  });
});

describe("GET /v1/admin/gateways", () => {
  it("reports the four communication providers from every tenant's integration settings, without secrets", async () => {
    const res = await get("/v1/admin/gateways", T_A, ["super_admin"]);
    expect(res.payload).not.toContain(SECRET_VALUE);
    const { data } = res.json();
    expect(data.map((g: any) => g.type)).toEqual(["SMS", "WhatsApp", "Email", "Push"]);
    const sms = data.find((g: any) => g.providerKey === "sms_twilio");
    expect(sms).toMatchObject({ provider: "Twilio SMS", status: "degraded", messagesPerDay: null, successRate: null });
    expect(sms.tenantsConnected).toBeGreaterThanOrEqual(1);
    expect(sms.tenantsFailed).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(Date.parse(sms.lastChecked))).toBe(true);
    // A disabled row is not counted as an enabled tenant.
    const push = data.find((g: any) => g.providerKey === "push_fcm");
    expect(push.tenantsFailed).toBe(0);
  });
});

describe("rate limit", () => {
  it("a per-route rate limit applies to the new reads (429 after 60/min from a non-loopback address)", async () => {
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await app.inject({ method: "GET", url: "/v1/admin/editions", remoteAddress: "10.20.30.40", headers: { authorization: `Bearer ${signToken({ sub: "cafe0020-0000-4000-8000-0000000000a2", tid: T_A, roles: ["super_admin"], sid: "sess-rl" }, SECRET, 3600)}` } })).statusCode;
    expect(last).toBe(429);
  });
});

describe("domain mapping", () => {
  it("gatewayStatus covers every branch", () => {
    const a = (connected: number, failed: number) => ({ enabled: connected + failed, connected, failed, lastTestedAt: null });
    expect(gatewayStatus(a(0, 0))).toBe("standby");
    expect(gatewayStatus(a(2, 0))).toBe("active");
    expect(gatewayStatus(a(2, 1))).toBe("degraded");
    expect(gatewayStatus(a(0, 3))).toBe("down");
  });
  it("views never invent pricing, caps or delivery figures", () => {
    expect(toEditionView({ code: "x", label: "X", subtitle: "", defaultModules: ["a", "b"] }, 3))
      .toMatchObject({ modulesIncluded: 2, pricing: null, tenants: 3 });
    expect(editionEntitlement("x", "a", "A")).toMatchObject({ tenant: "", limit: "", used: "" });
    expect(tenantOverride("x", "a", "A", "t", "T")).toMatchObject({ tenant: "T", tenantId: "t" });
    expect(toGatewayView("SMS", "sms_twilio", "Twilio SMS", { enabled: 0, connected: 0, failed: 0, lastTestedAt: null }))
      .toMatchObject({ messagesPerDay: null, successRate: null, lastChecked: null, status: "standby" });
    expect(GATEWAY_PROVIDERS).toHaveLength(4);
  });
});
