/**
 * UAT P3 b19 D-15: the Form 16 / 24Q / 26Q / 12BA deductor (employer) name, TAN
 * and PAN used to fall back to placeholder text ("<TAN — configure EMPLOYER_TAN>").
 * They now come from the tenant deductor configuration (payroll_settings, set
 * through PUT /v1/payroll/settings/deductor), falling back to the deployment
 * EMPLOYER_* env only when the tenant has none, and are validated (TAN
 * AAAA99999A, PAN AAAAA9999A, no placeholder). A missing / malformed /
 * placeholder value refuses the return with 422 DEDUCTOR_NOT_CONFIGURED naming
 * the field, instead of shipping placeholder text. Real Postgres.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn() };
});
import { fetchPayrollInput, fetchEmployeeSummaries } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import * as statutoryRepo from "../src/modules/statutory/repo.js";
import { registerDeductorConfigConsumers } from "../src/modules/deductor-config/consumer.js";
import { deductorProblems, DEDUCTOR_NOT_CONFIGURED } from "../src/modules/deductor-config/domain.js";

const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ADMIN = randomUUID();
const authFor = (tenant: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid: tenant, roles: ["super_admin"], sid: "d15" }, SECRET, 3600)}` });
const EMP = randomUUID();

let app: FastifyInstance;
beforeAll(async () => {
  registerPayrollConsumers(queue); registerDeductorConfigConsumers(queue); await queue.start(); app = await buildApp();
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2027-03", employees: [{ id: EMP, employeeNo: "D15-1", fullName: "Deductee One", pan: "BCDPK4321Q", basicMinor: "0" }], lopDays: {}, overtimeHours: {} } as never);
  vi.mocked(fetchEmployeeSummaries).mockResolvedValue(new Map() as never);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await queue.stop(); await app.close(); await sqlClient.end(); });

/** One NPS ledger row for 2026-08 (the NPS-SCF needs at least one). */
const seedNps = (tenant: string) => runWithTenant(tenant, () => db.transaction((tx) => statutoryRepo.insertNps(tx as never, {
  id: randomUUID(), tenantId: tenant, slipId: randomUUID(), employeeId: EMP, runId: randomUUID(), currency: "INR", period: "2026-08",
  basicMinor: 5000000n, empContribPct: "10", erContribPct: "14", empContribMinor: 500000n, erContribMinor: 700000n, createdBy: ADMIN, updatedBy: ADMIN,
})));

/** No deployment-wide fallback either: the tenant has nothing configured anywhere. */
const clearEnv = () => { vi.stubEnv("EMPLOYER_NAME", ""); vi.stubEnv("EMPLOYER_TAN", ""); vi.stubEnv("EMPLOYER_PAN", ""); };

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
});

describe("D-15: nothing configured -> every TDS return / certificate refuses with 422, never placeholder text", () => {
  it.each(refusingReturns().map((p) => [p.name, p] as const))("%s", async (_n, p) => {
    clearEnv();
    const tenant = randomUUID();
    const res = await app.inject({ method: p.method, url: p.url, headers: authFor(tenant), ...(p.payload ? { payload: p.payload } : {}) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe(DEDUCTOR_NOT_CONFIGURED);
    expect(res.json().message).toContain("deductor name is missing");
    expect(res.json().message).toContain("deductor TAN is missing");
    expect(res.json().message).toContain("deductor PAN is missing");
    expect(res.body).not.toContain("configure EMPLOYER");
  });

  it("a placeholder or malformed deployment-wide EMPLOYER_* value is refused too (message names the field)", async () => {
    vi.stubEnv("EMPLOYER_NAME", "Directorate of Accounts");
    vi.stubEnv("EMPLOYER_TAN", "<TAN — configure EMPLOYER_TAN>");
    vi.stubEnv("EMPLOYER_PAN", "AAAG1234K");
    const res = await app.inject({ method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${EMP}&fy=2026-27`, headers: authFor(randomUUID()) });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: DEDUCTOR_NOT_CONFIGURED });
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

describe("D-15: tenant deductor configuration (PUT /v1/payroll/settings/deductor)", () => {
  it("rejects a malformed TAN / PAN up front with 400 and stores nothing", async () => {
    clearEnv();
    const tenant = randomUUID();
    const bad = await app.inject({ method: "PUT", url: "/v1/payroll/settings/deductor", headers: authFor(tenant),
      payload: { name: "Directorate of Accounts", tan: "DEL1234C", pan: "AAAAA0000A" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("VALIDATION_FAILED");
    await memQueue.drain();
    const got = await app.inject({ method: "GET", url: "/v1/payroll/settings/deductor", headers: authFor(tenant) });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ configured: false, source: null, name: null, tan: null, pan: null });
  });

  it("a valid tenant deductor is used by Form 16 / 24Q / 26Q / 12BA / NPS-SCF, and wins over the deployment env", async () => {
    // A different, valid deployment-wide identity: the tenant own values must win.
    vi.stubEnv("EMPLOYER_NAME", "Deployment Default Office");
    vi.stubEnv("EMPLOYER_TAN", "MUMD54321E");
    vi.stubEnv("EMPLOYER_PAN", "AAACD5432L");
    const tenant = randomUUID();
    const put = await app.inject({ method: "PUT", url: "/v1/payroll/settings/deductor", headers: authFor(tenant),
      payload: { name: "  Pay and Accounts Office (Civil)  ", tan: "delp12345c", pan: "AAAGP1234K", reason: "set the deductor for UAT D-15" } });
    expect(put.statusCode).toBe(202);
    await memQueue.drain();
    const want = { name: "Pay and Accounts Office (Civil)", tan: "DELP12345C", pan: "AAAGP1234K" };

    const got = await app.inject({ method: "GET", url: "/v1/payroll/settings/deductor", headers: authFor(tenant) });
    expect(got.json()).toMatchObject({ configured: true, source: "tenant", ...want, problems: [] });

    const f24 = await app.inject({ method: "POST", url: "/v1/payroll/statutory/form24q/force-file", headers: authFor(tenant),
      payload: { fy: "2026-27", quarter: "Q1", confirmForce: true, reason: "D-15 probe" } });
    expect(f24.statusCode).toBe(200);
    expect(f24.json().deductor).toEqual(want);
    const f26 = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1&format=file", headers: authFor(tenant) });
    expect(f26.statusCode).toBe(200);
    expect(f26.body.split("\r\n")[0]).toBe("FH|26Q|2026-27|Q1|DELP12345C|AAAGP1234K|Pay and Accounts Office (Civil)|0");
    const ba = await app.inject({ method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${EMP}&fy=2026-27`, headers: authFor(tenant) });
    expect(ba.statusCode).toBe(200);
    expect(ba.json().employer).toEqual(want);
    const f16 = await app.inject({ method: "GET", url: `/v1/payroll/tax/form16?employeeId=${EMP}&fy=2026-27`, headers: authFor(tenant) });
    expect(f16.statusCode).toBe(200);
    expect(f16.json().form16PartA.deductor).toEqual(want);
    await seedNps(tenant);
    const nps = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps-scf?month=2026-08", headers: authFor(tenant) });
    expect(nps.statusCode).toBe(200);
    expect(nps.json().employer).toEqual(want);

    // The change is audited with before / after and the reason.
    const ev = await runWithTenant(tenant, () => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"}
         AND payload->>${"action"} = ${"deductor_updated"} AND payload->>${"resourceId"} = ${tenant}`)) as unknown as Array<{ payload: Record<string, unknown> }>));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({
      service: "payroll", resourceType: "payroll_settings", outcome: "success",
      detail: { before: null, after: want, reason: "set the deductor for UAT D-15" },
    });
  });

  it("with no tenant row, a valid deployment-wide EMPLOYER_* identity is used (source env)", async () => {
    vi.stubEnv("EMPLOYER_NAME", "Deployment Default Office");
    vi.stubEnv("EMPLOYER_TAN", "MUMD54321E");
    vi.stubEnv("EMPLOYER_PAN", "AAACD5432L");
    const tenant = randomUUID();
    const got = await app.inject({ method: "GET", url: "/v1/payroll/settings/deductor", headers: authFor(tenant) });
    expect(got.json()).toMatchObject({ configured: true, source: "env", name: "Deployment Default Office", tan: "MUMD54321E", pan: "AAACD5432L" });
    const ba = await app.inject({ method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${EMP}&fy=2026-27`, headers: authFor(tenant) });
    expect(ba.statusCode).toBe(200);
    expect(ba.json().employer).toEqual({ name: "Deployment Default Office", tan: "MUMD54321E", pan: "AAACD5432L" });
  });
});
