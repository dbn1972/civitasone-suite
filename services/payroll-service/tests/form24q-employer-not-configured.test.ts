/**
 * Form 24Q / 26Q (and 12BA, Form 16, GET /settings/deductor) for a tenant whose deductor identity is simply NOT THERE.
 *
 * Seen in UAT: GET /v1/payroll/statutory/form24q for tenant 11111111-1111-1111-1111-111111111111 answered 503
 * "Upstream service payroll returned 503". tenant-service logged 404 for GET /v1/tenants/<id> (no such tenant in its
 * registry), and deductor-config/tenant-identity.ts treated EVERY non-2xx as "tenant-service is down".
 *
 *   tenant-service says 404 NOT_FOUND  -> nothing is configured, retrying cannot help -> 422 FORM16_EMPLOYER_NOT_CONFIGURED
 *   tenant-service unreachable / 5xx / 401 / 403 / a 404 that is not its NOT_FOUND answer / bad body
 *                                      -> the identity is UNKNOWN -> still 503 TENANT_IDENTITY_UNAVAILABLE (fail closed)
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn() };
});
import { fetchPayrollInput, fetchEmployeeSummaries } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { FORM16_EMPLOYER_NOT_CONFIGURED } from "../src/modules/deductor-config/domain.js";
import { TENANT_IDENTITY_UNAVAILABLE, TENANT_NOT_REGISTERED_PROBLEM } from "../src/modules/deductor-config/repo.js";
import { readTenantDocIdentity, resetTenantDocIdentityCache, TenantIdentityUnavailableError, type FetchLike } from "../src/modules/deductor-config/tenant-identity.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ADMIN = randomUUID();
const EMP = randomUUID();
const authFor = (tenant: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid: tenant, roles: ["super_admin"], sid: "f24" }, SECRET, 3600)}` });
const realFetch = globalThis.fetch;

let app: FastifyInstance;
beforeAll(async () => {
  vi.unstubAllGlobals();
  registerPayrollConsumers(queue); await queue.start(); app = await buildApp();
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2027-03", employees: [{ id: EMP, employeeNo: "F24-1", fullName: "Deductee One", pan: "BCDPK4321Q", basicMinor: "0" }], lopDays: {}, overtimeHours: {} } as never);
  vi.mocked(fetchEmployeeSummaries).mockResolvedValue(new Map() as never);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetTenantDocIdentityCache(); });
afterAll(async () => { await queue.stop(); await app.close(); await sqlClient.end(); });

/** No deployment-wide deductor either: the deployment is multi-tenant, EMPLOYER_* unset. */
const multiTenant = () => { vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", ""); vi.stubEnv("EMPLOYER_NAME", ""); vi.stubEnv("EMPLOYER_TAN", ""); vi.stubEnv("EMPLOYER_PAN", ""); };

type Reply = { status: number; body: unknown } | "throw";
function stubTenantService(reply: Reply): void {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: unknown) => {
    if (!/\/v1\/tenants\/[^/?]+$/.test(String(input))) return realFetch(input as never, init as never);
    if (reply === "throw") throw new TypeError("fetch failed: connect ECONNREFUSED");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }));
}
const NOT_FOUND: Reply = { status: 404, body: { code: "NOT_FOUND", message: "tenant not found" } };

const get = (tenant: string, url: string) => app.inject({ method: "GET", url, headers: authFor(tenant) });
const returns = [
  ["Form 24Q", "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1"],
  ["Form 24Q file", "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1&format=file"],
  ["Form 26Q", "/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1"],
] as const;

describe("tenant-service has no such tenant (404 NOT_FOUND): employer not configured, not an outage", () => {
  it.each(returns)("%s -> 422 FORM16_EMPLOYER_NOT_CONFIGURED naming what is missing and that the tenant is unregistered", async (_n, url) => {
    multiTenant();
    stubTenantService(NOT_FOUND);
    const res = await get(randomUUID(), url);
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe(FORM16_EMPLOYER_NOT_CONFIGURED);
    expect(body.message).toContain("deductor name is missing");
    expect(body.message).toContain("deductor TAN is missing");
    expect(body.message).toContain(TENANT_NOT_REGISTERED_PROBLEM);
  });

  it("GET /settings/deductor reports configured:false with the same problems (200, not 503)", async () => {
    multiTenant();
    stubTenantService(NOT_FOUND);
    const res = await get(randomUUID(), "/v1/payroll/settings/deductor");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, source: null });
    expect(res.json().problems).toContain(TENANT_NOT_REGISTERED_PROBLEM);
  });

  it("Form 12BA and Form 16 (same gate) answer 422 too", async () => {
    multiTenant();
    stubTenantService(NOT_FOUND);
    const t = randomUUID();
    expect((await get(t, `/v1/payroll/statutory/form12ba?employeeId=${EMP}&fy=2026-27`)).statusCode).toBe(422);
    expect((await get(t, `/v1/payroll/tax/form16?employeeId=${EMP}&fy=2026-27`)).statusCode).toBe(422);
  });

  it("a deployment that is explicitly single-tenant still uses its EMPLOYER_* identity for an unregistered tenant", async () => {
    vi.stubEnv("PAYROLL_DEDUCTOR_ENV_FALLBACK", "single-tenant");
    vi.stubEnv("EMPLOYER_NAME", "Deployment Default Office"); vi.stubEnv("EMPLOYER_TAN", "MUMD54321E"); vi.stubEnv("EMPLOYER_PAN", "AAACD5432L");
    stubTenantService(NOT_FOUND);
    const res = await get(randomUUID(), "/v1/payroll/settings/deductor");
    expect(res.json()).toMatchObject({ configured: true, source: "env", tan: "MUMD54321E" });
  });
});

describe("a real outage stays 503 TENANT_IDENTITY_UNAVAILABLE, and says what happened", () => {
  const outages: Array<[string, Reply, RegExp]> = [
    ["tenant-service 500", { status: 500, body: { code: "INTERNAL" } }, /HTTP 500/],
    ["tenant-service 502", { status: 502, body: {} }, /HTTP 502/],
    ["tenant-service 401 (internal credential refused)", { status: 401, body: { code: "UNAUTHENTICATED" } }, /HTTP 401/],
    ["tenant-service 403", { status: 403, body: { code: "FORBIDDEN" } }, /HTTP 403/],
    ["a 404 that is NOT tenant-service's NOT_FOUND (mis-routed URL)", { status: 404, body: { message: "Route GET:/v1/tenants/x not found" } }, /HTTP 404/],
    ["fetch throws (connection refused)", "throw", /ECONNREFUSED/],
    ["200 with a non-object body", { status: 200, body: null }, /not a tenant record/],
  ];
  it.each(outages)("%s", async (_n, reply, reason) => {
    multiTenant();
    stubTenantService(reply);
    for (const [, url] of returns) {
      const res = await get(randomUUID(), url);
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe(TENANT_IDENTITY_UNAVAILABLE);
      expect(res.json().message).toMatch(reason);
    }
  });
});

describe("readTenantDocIdentity classification (unit)", () => {
  const T = randomUUID();
  const reply = (status: number, body: unknown): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  it("404 NOT_FOUND (flat or nested code) -> unregistered, empty identity", async () => {
    for (const body of [{ code: "NOT_FOUND" }, { error: { code: "NOT_FOUND" } }]) {
      resetTenantDocIdentityCache();
      expect(await readTenantDocIdentity(T, reply(404, body))).toMatchObject({ registered: false, orgName: null, tan: null, pan: null });
    }
  });
  it("404 with an unreadable or different body -> unavailable", async () => {
    resetTenantDocIdentityCache();
    await expect(readTenantDocIdentity(T, reply(404, { code: "ROUTE_NOT_FOUND" }))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
    resetTenantDocIdentityCache();
    await expect(readTenantDocIdentity(T, async () => ({ ok: false, status: 404, json: async () => { throw new Error("html"); } }))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });
  it("2xx with no documentIdentity -> registered (undefined), empty identity; 5xx -> unavailable", async () => {
    resetTenantDocIdentityCache();
    const ok = await readTenantDocIdentity(T, reply(200, { data: { name: "N", settings: {} } }));
    expect(ok.registered).toBeUndefined();
    resetTenantDocIdentityCache();
    await expect(readTenantDocIdentity(T, reply(503, {}))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });
});
