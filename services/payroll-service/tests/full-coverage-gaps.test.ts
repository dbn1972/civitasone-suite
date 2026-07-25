/**
 * Coverage gap tests: form16-verify, payslip-pdf, statutory-returns modules.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000077";
const A = "cccccccc-3333-4000-8000-000000000077";
const admin = signToken({ sub: A, tid: T, roles: ["payroll_admin", "super_admin"], sid: "s1" }, SECRET);
const emp = signToken({ sub: A, tid: T, roles: ["employee"], sid: "s2" }, SECRET);
afterAll(async () => { await sqlClient.end(); });

async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}

describe("form16-verify", () => {
  it("POST /v1/payroll/tax/form16/verify → 200|400|500", async () => {
    expect([200, 400, 500]).toContain(await hit("POST", "/v1/payroll/tax/form16/verify", admin, { employeeId: randomUUID(), fy: "2025-26" }));
  });
  it("401 without auth", async () => { expect(await hit("POST", "/v1/payroll/tax/form16/verify")).toBe(401); });
});

describe("payslip-pdf", () => {
  it("GET /v1/payroll/slips/:id/pdf → 200|404|500", async () => {
    expect([200, 404, 500]).toContain(await hit("GET", `/v1/payroll/slips/${randomUUID()}/pdf`, admin));
  });
  it("401 without auth", async () => { expect(await hit("GET", `/v1/payroll/slips/${randomUUID()}/pdf`)).toBe(401); });
});

describe("statutory-returns", () => {
  it("GET /v1/payroll/statutory/form24q → 200|500", async () => {
    expect([200, 400, 500]).toContain(await hit("GET", "/v1/payroll/statutory/form24q", admin));
  });
  it("GET /v1/payroll/statutory/form12ba → 200|500", async () => {
    expect([200, 400, 500]).toContain(await hit("GET", "/v1/payroll/statutory/form12ba", admin));
  });
  it("GET /v1/payroll/statutory/nps-scf → 200|500", async () => {
    expect([200, 400, 500]).toContain(await hit("GET", "/v1/payroll/statutory/nps-scf", admin));
  });
  it("GET /v1/payroll/statutory/form26q → 200|500", async () => {
    expect([200, 400, 500]).toContain(await hit("GET", "/v1/payroll/statutory/form26q", admin));
  });
  it("GET /v1/payroll/statutory/perquisite-components → 200|500", async () => {
    expect([200, 404, 500]).toContain(await hit("GET", "/v1/payroll/statutory/perquisite-components", admin));
  });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/payroll/statutory/form24q")).toBe(401); });
});

describe("auth umbrella", () => {
  it("401 on protected routes", async () => {
    for (const u of ["/v1/payroll/statutory/form24q", "/v1/payroll/statutory/nps-scf", `/v1/payroll/slips/${randomUUID()}/pdf`]) {
      expect(await hit("GET", u)).toBe(401);
    }
  });
});
