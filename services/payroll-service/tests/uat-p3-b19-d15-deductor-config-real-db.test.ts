/**
 * UAT P3 b19 D-15: the Form 16 / 24Q / 26Q / 12BA deductor (employer) name, TAN
 * and PAN used to fall back to placeholder text ("<TAN — configure EMPLOYER_TAN>").
 *
 * Review decision: ONE source of deductor identity, shared with the official
 * documents of PR #2463 -- tenant-service `settings.documentIdentity`
 * { orgName, tan, pan, address, deductorCategory } -- falling back to the
 * deployment EMPLOYER_* env only when documentIdentity has none of
 * name / TAN / PAN. Validated (TAN AAAA99999A mandatory; PAN AAAAA9999A, or
 * PANNOTREQD for a deductorCategory "government" deductor only; no
 * placeholder). A missing / malformed / placeholder value refuses with 422
 * FORM16_EMPLOYER_NOT_CONFIGURED (the #2463 code) naming the field. Tenant-
 * service is stubbed at fetch; a tenant-service outage fails OPEN (env /
 * refusal), never a 500. Real Postgres.
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
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import * as statutoryRepo from "../src/modules/statutory/repo.js";
import { deductorProblems, FORM16_EMPLOYER_NOT_CONFIGURED, PAN_NOT_REQUIRED } from "../src/modules/deductor-config/domain.js";
import { resetTenantDocIdentityCache } from "../src/modules/deductor-config/tenant-identity.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ADMIN = randomUUID();
const authFor = (tenant: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid: tenant, roles: ["super_admin"], sid: "d15" }, SECRET, 3600)}` });
const EMP = randomUUID();
const realFetch = globalThis.fetch;

let app: FastifyInstance;
beforeAll(async () => {
  registerPayrollConsumers(queue); await queue.start(); app = await buildApp();
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2027-03", employees: [{ id: EMP, employeeNo: "D15-1", fullName: "Deductee One", pan: "BCDPK4321Q", basicMinor: "0" }], lopDays: {}, overtimeHours: {} } as never);
  vi.mocked(fetchEmployeeSummaries).mockResolvedValue(new Map() as never);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetTenantDocIdentityCache(); });
afterAll(async () => { await queue.stop(); await app.close(); await sqlClient.end(); });

/** One NPS ledger row for 2026-08 (the NPS-SCF needs at least one). */
const seedNps = (tenant: string) => runWithTenant(tenant, () => db.transaction((tx) => statutoryRepo.insertNps(tx as never, {
  id: randomUUID(), tenantId: tenant, slipId: randomUUID(), employeeId: EMP, runId: randomUUID(), currency: "INR", period: "2026-08",
  basicMinor: 5000000n, empContribPct: "10", erContribPct: "14", empContribMinor: 500000n, erContribMinor: 700000n, createdBy: ADMIN, updatedBy: ADMIN,
})));

/** No deployment-wide fallback either. */
const clearEnv = () => { vi.stubEnv("EMPLOYER_NAME", ""); vi.stubEnv("EMPLOYER_TAN", ""); vi.stubEnv("EMPLOYER_PAN", ""); };
const deploymentEnv = () => {
  vi.stubEnv("EMPLOYER_NAME", "Deployment Default Office"); vi.stubEnv("EMPLOYER_TAN", "MUMD54321E"); vi.stubEnv("EMPLOYER_PAN", "AAACD5432L");
};

type TenantReply = { status: number; body: unknown } | "throw";
interface TenantCall { url: string; headers: Record<string, string> }
/**
 * Stub tenant-service GET /v1/tenants/:id at fetch (every other URL goes to the
 * real fetch). `tenants` maps a tenant id to the reply.
 */
function stubTenantService(tenants: Record<string, TenantReply>): TenantCall[] {
  const calls: TenantCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    const m = /\/v1\/tenants\/([^/?]+)$/.exec(url);
    if (!m) return realFetch(input as never, init as never);
    calls.push({ url, headers: init?.headers ?? {} });
    const r = tenants[decodeURIComponent(m[1]!)] ?? { status: 404, body: { code: "NOT_FOUND" } };
    if (r === "throw") throw new TypeError("fetch failed: connect ECONNREFUSED");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }));
  return calls;
}
const withIdentity = (documentIdentity: Record<string, unknown>, name = "Tenant Display Name"): TenantReply =>
  ({ status: 200, body: { data: { id: "t", name, settings: { documentIdentity, other: 1 } } } });

type Probe = { name: string; method: "GET" | "POST"; url: string; payload?: Record<string, unknown> };
const refusingReturns = (): Probe[] => [
  { name: "Form 24Q", method: "GET", url: "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1" },
  { name: "Form 24Q file", method: "GET", url: "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1&format=file" },
  { name: "Form 24Q force-file", method: "POST", url: "/v1/payroll/statutory/form24q/force-file", payload: { fy: "2026-27", quarter: "Q1", confirmForce: true, reason: "D-15 probe" } },
  { name: "Form 26Q", method: "GET", url: "/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1" },
  { name: "Form 12BA", method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${EMP}&fy=2026-27` },
  { name: "Form 16", method: "GET", url: `/v1/payroll/tax/form16?employeeId=${EMP}&fy=2026-27` },
  { name: "Form 16 PDF (html)", method: "GET", url: `/v1/payroll/tax/form16/${EMP}/pdf?fy=2026-27&output=html` },
  { name: "Form 16 bulk", method: "POST", url: "/v1/payroll/tax/form16/bulk-generate", payload: { fy: "2026-27" } },
];
const forceFile24Q = (tenant: string) => app.inject({ method: "POST", url: "/v1/payroll/statutory/form24q/force-file", headers: authFor(tenant),
  payload: { fy: "2026-27", quarter: "Q1", confirmForce: true, reason: "D-15 probe" } });
const form16 = (tenant: string) => app.inject({ method: "GET", url: `/v1/payroll/tax/form16?employeeId=${EMP}&fy=2026-27`, headers: authFor(tenant) });
const form12ba = (tenant: string) => app.inject({ method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${EMP}&fy=2026-27`, headers: authFor(tenant) });
const getDeductor = (tenant: string) => app.inject({ method: "GET", url: "/v1/payroll/settings/deductor", headers: authFor(tenant) });

describe("D-15 deductor validation (pure)", () => {
  it("accepts a well-formed TAN / PAN / name", () => {
    expect(deductorProblems({ name: "Office of the Pay and Accounts Officer", tan: "DELP12345C", pan: "AAAGP1234K" })).toEqual([]);
  });
  it("names each missing, malformed or placeholder field", () => {
    expect(deductorProblems({ name: null, tan: null, pan: null })).toEqual([
      "deductor name is missing", "deductor TAN is missing", "deductor PAN is missing",
    ]);
    expect(deductorProblems({ name: "Org", tan: "DEL12345C", pan: "AAAGP1234" })).toEqual([
      "deductor TAN \"DEL12345C\" is not a valid TAN (format AAAA99999A)",
      "deductor PAN \"AAAGP1234\" is not a valid PAN (format AAAAA9999A)",
    ]);
    expect(deductorProblems({ name: "<EMPLOYER NAME — configure EMPLOYER_NAME>", tan: "<TAN — configure EMPLOYER_TAN>", pan: "<PAN — configure EMPLOYER_PAN>" })).toEqual([
      "deductor name is a placeholder", "deductor TAN is a placeholder", "deductor PAN is a placeholder",
    ]);
    // Well-formed but known placeholder / impossible values (sequence number 0000 / 00000).
    expect(deductorProblems({ name: "Org", tan: "AAAA00000A", pan: "AAAAA0000A" })).toEqual([
      "deductor TAN is a placeholder", "deductor PAN is a placeholder",
    ]);
    expect(deductorProblems({ name: "Org", tan: "XXXX99999X", pan: "ABCDE1234F" })).toEqual([
      "deductor TAN is a placeholder", "deductor PAN is a placeholder",
    ]);
  });
  it("PANNOTREQD is accepted only for a government deductor (TRACES / 24Q convention); TAN stays mandatory", () => {
    expect(PAN_NOT_REQUIRED).toBe("PANNOTREQD");
    expect(deductorProblems({ name: "PAO (Civil)", tan: "DELP12345C", pan: "PANNOTREQD", deductorCategory: "government" })).toEqual([]);
    expect(deductorProblems({ name: "PAO (Civil)", tan: "DELP12345C", pan: "pannotreqd", deductorCategory: "Government" })).toEqual([]);
    for (const deductorCategory of [undefined, null, "company", "governments", ""]) {
      const p = deductorProblems({ name: "PAO (Civil)", tan: "DELP12345C", pan: "PANNOTREQD", deductorCategory });
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(/^deductor PAN "PANNOTREQD" is allowed only for a government deductor/);
    }
    // A government deductor still needs a real TAN.
    expect(deductorProblems({ name: "PAO (Civil)", tan: null, pan: "PANNOTREQD", deductorCategory: "government" })).toEqual(["deductor TAN is missing"]);
    expect(deductorProblems({ name: "PAO (Civil)", tan: "DELP1234C", pan: "PANNOTREQD", deductorCategory: "government" })).toEqual([
      "deductor TAN \"DELP1234C\" is not a valid TAN (format AAAA99999A)",
    ]);
  });
});

describe("D-15: nothing configured -> every TDS return / certificate refuses with 422 FORM16_EMPLOYER_NOT_CONFIGURED", () => {
  it.each(refusingReturns().map((p) => [p.name, p] as const))("%s", async (_n, p) => {
    clearEnv();
    const tenant = randomUUID();
    // tenant-service answers, but the tenant has no documentIdentity (its display name alone is not a deductor).
    stubTenantService({ [tenant]: { status: 200, body: { data: { id: tenant, name: "Some Tenant", settings: {} } } } });
    const res = await app.inject({ method: p.method, url: p.url, headers: authFor(tenant), ...(p.payload ? { payload: p.payload } : {}) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(FORM16_EMPLOYER_NOT_CONFIGURED);
    expect(res.json().message).toContain("deductor name is missing");
    expect(res.json().message).toContain("deductor TAN is missing");
    expect(res.json().message).toContain("deductor PAN is missing");
    expect(res.json().message).toContain("documentIdentity");
    expect(res.body).not.toContain("configure EMPLOYER");
  });

  it("a placeholder or malformed deployment-wide EMPLOYER_* value is refused too (message names the field)", async () => {
    vi.stubEnv("EMPLOYER_NAME", "Directorate of Accounts");
    vi.stubEnv("EMPLOYER_TAN", "<TAN — configure EMPLOYER_TAN>");
    vi.stubEnv("EMPLOYER_PAN", "AAAG1234K");
    const res = await form12ba(randomUUID());
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: FORM16_EMPLOYER_NOT_CONFIGURED });
    expect(res.json().message).toContain("deductor TAN is a placeholder");
    expect(res.json().message).toContain("deductor PAN \"AAAG1234K\" is not a valid PAN");
    expect(res.json().message).not.toContain("deductor name");
  });

  it("NPS-SCF (not a TDS return) still generates, but never with placeholder employer text", async () => {
    clearEnv();
    const tenant = randomUUID();
    await seedNps(tenant);
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps-scf?month=2026-08", headers: authFor(tenant) });
    expect(res.statusCode).toBe(200);
    expect(res.json().employer).toEqual({ name: null, tan: null, pan: null });
    expect(res.body).not.toContain("configure EMPLOYER");
  });
});

describe("D-15: tenant documentIdentity is the deductor source", () => {
  it("documentIdentity is used by Form 16 / 24Q / 26Q / 12BA / NPS-SCF and wins over the deployment env", async () => {
    deploymentEnv();
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "d15-internal-secret"); // gitleaks:allow (test-only value)
    const tenant = randomUUID();
    const calls = stubTenantService({ [tenant]: withIdentity({ orgName: "  Pay and Accounts Office (Civil)  ", tan: "delp12345c", pan: "AAAGP1234K", address: "Lodhi Road, New Delhi" }) });
    const want = { name: "Pay and Accounts Office (Civil)", tan: "DELP12345C", pan: "AAAGP1234K" };

    const got = await getDeductor(tenant);
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({
      source: "documentIdentity", ...want, address: "Lodhi Road, New Delhi", deductorCategory: null, configured: true, problems: [],
    });
    // The tenant-service request is the internal-boundary one (#2463 resolveDocIdentity).
    expect(calls[0]!.url).toBe(`http://127.0.0.1:1/v1/tenants/${tenant}`);
    expect(calls[0]!.headers).toMatchObject({ "x-internal": "1", "x-service-secret": "d15-internal-secret", "x-tenant-id": tenant }); // gitleaks:allow (test-only value)

    const f24 = await forceFile24Q(tenant);
    expect(f24.statusCode).toBe(200);
    expect(f24.json().deductor).toEqual(want);
    const f26 = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1&format=file", headers: authFor(tenant) });
    expect(f26.statusCode).toBe(200);
    expect(f26.body.split("\r\n")[0]).toBe("FH|26Q|2026-27|Q1|DELP12345C|AAAGP1234K|Pay and Accounts Office (Civil)|0");
    const ba = await form12ba(tenant);
    expect(ba.statusCode).toBe(200);
    expect(ba.json().employer).toEqual(want);
    const f16 = await form16(tenant);
    expect(f16.statusCode).toBe(200);
    expect(f16.json().form16PartA.deductor).toEqual(want);
    await seedNps(tenant);
    const nps = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps-scf?month=2026-08", headers: authFor(tenant) });
    expect(nps.statusCode).toBe(200);
    expect(nps.json().employer).toEqual(want);
    // 60 s cache: one tenant-service read for all of the above.
    expect(calls).toHaveLength(1);
  });

  it("body without the data envelope ({ settings }) is read too; no orgName -> the tenant name (as #2463)", async () => {
    clearEnv();
    const tenant = randomUUID();
    stubTenantService({ [tenant]: { status: 200, body: { id: tenant, name: "Directorate of Treasuries", settings: { documentIdentity: { tan: "BLRD12345F", pan: "AAAGD1234M" } } } } });
    const got = await getDeductor(tenant);
    expect(got.json()).toMatchObject({ source: "documentIdentity", configured: true, name: "Directorate of Treasuries", tan: "BLRD12345F", pan: "AAAGD1234M" });
  });

  it("PANNOTREQD + deductorCategory government is accepted: 24Q and Form 16 print PANNOTREQD", async () => {
    clearEnv();
    const tenant = randomUUID();
    stubTenantService({ [tenant]: withIdentity({ orgName: "Pay and Accounts Office (Civil)", tan: "DELP12345C", pan: "PANNOTREQD", deductorCategory: "government" }) });
    const want = { name: "Pay and Accounts Office (Civil)", tan: "DELP12345C", pan: "PANNOTREQD" };
    expect((await getDeductor(tenant)).json()).toMatchObject({ configured: true, deductorCategory: "government", problems: [], ...want });
    const f24 = await forceFile24Q(tenant);
    expect(f24.statusCode).toBe(200);
    expect(f24.json().deductor).toEqual(want);
    const f16 = await form16(tenant);
    expect(f16.statusCode).toBe(200);
    expect(f16.json().form16PartA.deductor).toEqual(want);
    const html = await app.inject({ method: "GET", url: `/v1/payroll/tax/form16/${EMP}/pdf?fy=2026-27&output=html`, headers: authFor(tenant) });
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain("PANNOTREQD");
    const f26 = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1&format=file", headers: authFor(tenant) });
    expect(f26.body.split("\r\n")[0]).toBe("FH|26Q|2026-27|Q1|DELP12345C|PANNOTREQD|Pay and Accounts Office (Civil)|0");
  });

  it("PANNOTREQD without deductorCategory government is refused naming the PAN field", async () => {
    deploymentEnv(); // a valid env is NOT mixed in field by field
    const tenant = randomUUID();
    stubTenantService({ [tenant]: withIdentity({ orgName: "Acme Payroll Pvt Ltd", tan: "DELA12345C", pan: "PANNOTREQD", deductorCategory: "company" }) });
    for (const res of [await forceFile24Q(tenant), await form16(tenant)]) {
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(FORM16_EMPLOYER_NOT_CONFIGURED);
      expect(res.json().message).toContain("deductor PAN \"PANNOTREQD\" is allowed only for a government deductor");
      expect(res.json().message).not.toContain("deductor TAN");
      expect(res.json().message).not.toContain("deductor name");
    }
  });

  it("a malformed documentIdentity TAN is refused (no fallback to the valid env TAN)", async () => {
    deploymentEnv();
    const tenant = randomUUID();
    stubTenantService({ [tenant]: withIdentity({ orgName: "Pay and Accounts Office (Civil)", tan: "DEL12345C", pan: "PANNOTREQD", deductorCategory: "government" }) });
    const res = await forceFile24Q(tenant);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(FORM16_EMPLOYER_NOT_CONFIGURED);
    expect(res.json().message).toContain("deductor TAN \"DEL12345C\" is not a valid TAN");
    expect(res.json().message).not.toContain("deductor PAN");
    expect((await getDeductor(tenant)).json()).toMatchObject({ source: "documentIdentity", configured: false, tan: "DEL12345C",
      problems: ["deductor TAN \"DEL12345C\" is not a valid TAN (format AAAA99999A)"] });
  });

  it("documentIdentity without name / TAN / PAN -> the deployment-wide EMPLOYER_* identity (source env)", async () => {
    deploymentEnv();
    const tenant = randomUUID();
    stubTenantService({ [tenant]: withIdentity({ address: "only an address", gstin: "07AAAGP1234K1Z5" }) });
    const env = { name: "Deployment Default Office", tan: "MUMD54321E", pan: "AAACD5432L" };
    expect((await getDeductor(tenant)).json()).toEqual({ source: "env", ...env, address: null, deductorCategory: null, configured: true, problems: [] });
    const ba = await form12ba(tenant);
    expect(ba.statusCode).toBe(200);
    expect(ba.json().employer).toEqual(env);
  });

  it("GET with nothing anywhere -> source null and every problem listed", async () => {
    clearEnv();
    const tenant = randomUUID();
    stubTenantService({ [tenant]: withIdentity({}) });
    expect((await getDeductor(tenant)).json()).toEqual({
      source: null, name: null, tan: null, pan: null, address: null, deductorCategory: null, configured: false,
      problems: ["deductor name is missing", "deductor TAN is missing", "deductor PAN is missing"],
    });
  });
});

describe("D-15: tenant-service unreachable fails OPEN (env fallback or 422), never a 500", () => {
  const outages: Array<[string, (tenant: string) => void]> = [
    ["connection refused (real, dead TENANT_SERVICE_URL)", () => { /* no stub: TENANT_SERVICE_URL is a dead port in vitest.config.ts */ }],
    ["fetch throws", (tenant) => { stubTenantService({ [tenant]: "throw" }); }],
    ["tenant-service 500", (tenant) => { stubTenantService({ [tenant]: { status: 500, body: { code: "INTERNAL" } } }); }],
    ["tenant-service 200 with a non-JSON-object body", (tenant) => { stubTenantService({ [tenant]: { status: 200, body: null } }); }],
  ];
  it.each(outages)("%s: env fallback is used", async (_n, outage) => {
    deploymentEnv();
    const tenant = randomUUID();
    outage(tenant);
    const f24 = await forceFile24Q(tenant);
    expect(f24.statusCode).toBe(200);
    expect(f24.json().deductor).toEqual({ name: "Deployment Default Office", tan: "MUMD54321E", pan: "AAACD5432L" });
    expect((await getDeductor(tenant)).json()).toMatchObject({ source: "env", configured: true });
  });
  it.each(outages)("%s: no env -> 422 FORM16_EMPLOYER_NOT_CONFIGURED", async (_n, outage) => {
    clearEnv();
    const tenant = randomUUID();
    outage(tenant);
    for (const res of [await forceFile24Q(tenant), await form16(tenant), await form12ba(tenant)]) {
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe(FORM16_EMPLOYER_NOT_CONFIGURED);
    }
    const got = await getDeductor(tenant);
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ source: null, configured: false });
  });
  it("a failed read is not cached: the next request sees the configured identity", async () => {
    clearEnv();
    const tenant = randomUUID();
    stubTenantService({ [tenant]: "throw" });
    expect((await forceFile24Q(tenant)).statusCode).toBe(422);
    stubTenantService({ [tenant]: withIdentity({ orgName: "Pay and Accounts Office (Civil)", tan: "DELP12345C", pan: "AAAGP1234K" }) });
    expect((await forceFile24Q(tenant)).statusCode).toBe(200);
  });
});

describe("D-15: the payroll-owned write path is gone (documentIdentity is set in tenant-service)", () => {
  it("PUT /v1/payroll/settings/deductor no longer exists", async () => {
    const res = await app.inject({ method: "PUT", url: "/v1/payroll/settings/deductor", headers: authFor(randomUUID()),
      payload: { name: "Directorate of Accounts", tan: "DELP12345C", pan: "AAAGP1234K" } });
    expect(res.statusCode).toBe(404);
  });
});
