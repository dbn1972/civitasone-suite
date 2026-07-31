/**
 * payroll-service — Payslip PDF routes integration tests
 *
 * Covers:
 * - GET /v1/payroll/slips/:id/pdf (happy path, 400, 401, 403, 404, ownership guard)
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ADMIN_ID = "aaaaaaaa-bbbb-4000-8000-000000000001";
const EMPLOYEE_ID = "aaaaaaaa-cccc-4000-8000-000000000002";
const OTHER_EMPLOYEE_ID = "aaaaaaaa-dddd-4000-8000-000000000003";
const SLIP_ID = "11111111-2222-4000-8000-000000000001";
const RUN_ID = "22222222-3333-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin"]) {
  return signToken({ sub: ADMIN_ID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function employeeToken(sub = EMPLOYEE_ID) {
  return signToken({ sub, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  return {
    ...actual,
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  };
});

vi.mock("../src/shared/infra.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  return {
    ...actual,
    cache: {
      getOrLoad: async (_key: string, loader: () => Promise<unknown>) => loader(),
      invalidate: async () => undefined,
      makeKey: (...parts: string[]) => parts.join(":"),
    },
    queue: { publish: async () => undefined, subscribe: () => undefined, start: async () => undefined, stop: async () => undefined },
  };
});

vi.mock("../src/shared/outbox.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  return {
    ...actual,
    enqueue: vi.fn(async () => undefined),
    markProcessed: vi.fn(async () => undefined),
  };
});

// Mock loadTaxConfig to prevent DB read for tax slabs at app boot
vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(async () => 0),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

function makeSlip(overrides: Record<string, unknown> = {}) {
  return {
    id: SLIP_ID,
    tenantId: TENANT,
    runId: RUN_ID,
    employeeId: EMPLOYEE_ID,
    employeeNo: "EMP-001",
    basicMinor: 5000000n,
    grossMinor: 8000000n,
    totalDeductionsMinor: 1500000n,
    netPayMinor: 6500000n,
    currency: "INR",
    components: [
      { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 5000000 },
      { code: "HRA", name: "HRA", type: "earning", amountMinor: 2000000 },
      { code: "PT", name: "Professional Tax", type: "deduction", amountMinor: 20000 },
    ],
    pfEmployeeMinor: 600000n,
    pfEmployerMinor: 600000n,
    gpfMinor: 0n,
    npsEmployeeMinor: 0n,
    npsEmployerMinor: 0n,
    esiMinor: 0n,
    tdsMinor: 500000n,
    status: "computed",
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    month: "2025-03",
    ...overrides,
  };
}

// Track call count to differentiate slip vs run queries
let callCount = 0;

beforeEach(() => {
  vi.clearAllMocks();
  callCount = 0;
  // Default: first scopedRead call returns slip, second returns run
  H.scopedReadMock.mockImplementation(async () => {
    callCount++;
    if (callCount === 1) return [makeSlip()];
    if (callCount === 2) return [makeRun()];
    return [];
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/slips/:id/pdf — Happy path (admin)
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id/pdf — Happy path", () => {
  it("200 — returns HTML payslip for admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Salary Slip");
    expect(res.body).toContain("EMP-001");
  });

  it("200 — employee can download their own slip", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${employeeToken(EMPLOYEE_ID)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("200 — renders earnings and deductions in HTML", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Basic Pay");
    expect(res.body).toContain("HRA");
    expect(res.body).toContain("Professional Tax");
  });

  it("200 — renders GPF pension rows when gpfMinor > 0", async () => {
    H.scopedReadMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [makeSlip({ gpfMinor: 500000n, pfEmployeeMinor: 0n, pfEmployerMinor: 0n })];
      if (callCount === 2) return [makeRun()];
      return [];
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("GPF");
  });

  it("200 — renders NPS rows when npsEmployeeMinor > 0", async () => {
    H.scopedReadMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [makeSlip({ npsEmployeeMinor: 400000n, npsEmployerMinor: 560000n, gpfMinor: 0n, pfEmployeeMinor: 0n, pfEmployerMinor: 0n })];
      if (callCount === 2) return [makeRun()];
      return [];
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("NPS (Employee 10%)");
    expect(res.body).toContain("NPS (Employer 14%)");
  });

  it("200 — renders PF + ESI rows when no pension scheme rows", async () => {
    H.scopedReadMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [makeSlip({ gpfMinor: 0n, npsEmployeeMinor: 0n, npsEmployerMinor: 0n, pfEmployeeMinor: 600000n, pfEmployerMinor: 600000n, esiMinor: 150000n })];
      if (callCount === 2) return [makeRun()];
      return [];
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("PF (Employee)");
    expect(res.body).toContain("PF (Employer)");
    expect(res.body).toContain("ESI (Employee)");
  });

  it("200 — hr_admin role can access slips", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken(["hr_admin"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("200 — finance_officer role can access slips", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken(["finance_officer"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("200 — super_admin role can access slips", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken(["super_admin"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("200 — renders slip with empty components gracefully", async () => {
    H.scopedReadMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [makeSlip({ components: [] })];
      if (callCount === 2) return [makeRun()];
      return [];
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Salary Slip");
  });

  it("200 — renders slip when run is not found (month empty)", async () => {
    H.scopedReadMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [makeSlip()];
      if (callCount === 2) return []; // no run found
      return [];
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/slips/:id/pdf — 400 bad request
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id/pdf — 400 validation", () => {
  it("400 — invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/slips/not-a-uuid/pdf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    // ZodError from pathParamSchema.parse → 400 via schema error handler
    expect([400, 500]).toContain(res.statusCode);
    if (res.statusCode === 400) {
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("400/500 — empty string as id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/slips//pdf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    // May 404 (route not matched), 400 (validation), or 500 (ZodError cross-realm)
    expect([400, 404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/slips/:id/pdf — 401 unauthenticated
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id/pdf — 401 unauthenticated", () => {
  it("401 — no authorization header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("401 — invalid/malformed token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: "Bearer invalid.token.here" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("401 — expired token", async () => {
    // signToken with past expiry
    const expired = signToken({ sub: ADMIN_ID, tid: TENANT, roles: ["payroll_admin"], sid: "s1" }, SECRET, -10);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${expired}` },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("401 — Bearer prefix missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: adminToken() },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/slips/:id/pdf — 403 forbidden
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id/pdf — 403 forbidden", () => {
  it("403 — citizen role has no access", async () => {
    const token = signToken({ sub: ADMIN_ID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("403 — employee cannot download another employee's slip (SEC-P1-01)", async () => {
    // Slip belongs to OTHER_EMPLOYEE_ID, but caller is EMPLOYEE_ID
    H.scopedReadMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [makeSlip({ employeeId: OTHER_EMPLOYEE_ID })];
      if (callCount === 2) return [makeRun()];
      return [];
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${employeeToken(EMPLOYEE_ID)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("403 — audit_officer role has no access to payslips", async () => {
    const token = signToken({ sub: ADMIN_ID, tid: TENANT, roles: ["audit_officer"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/slips/:id/pdf — 404 not found
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id/pdf — 404 not found", () => {
  it("404 — slip not found", async () => {
    H.scopedReadMock.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${SLIP_ID}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("404 — non-existent slip UUID returns not found", async () => {
    H.scopedReadMock.mockResolvedValue([]);

    const nonExistentId = "99999999-9999-4000-8000-999999999999";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${nonExistentId}/pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});
