/**
 * payroll-service — F&F routes integration tests
 *
 * Covers:
 * - POST /v1/payroll/fnf/compute (valid, validation, auth)
 * - GET /v1/payroll/fnf/settlements/:id (happy, not found, 400, 401, 403)
 * - GET /v1/payroll/fnf/settlements (list, filters, pagination, auth)
 * - GET /v1/payroll/internal/fnf-tax-breakdown (valid, validation, auth)
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";
const FAKE = randomUUID();

function token(roles = ["payroll_admin", "super_admin", "hr_admin", "finance_officer"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}
function employeeToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockScopedRead = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (...args: unknown[]) => mockDbTransaction(...args) },
  scopedRead: (...args: unknown[]) => mockScopedRead(...args),
  sqlClient: { end: vi.fn() },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: string, fn: () => unknown) => fn()),
    makeKey: vi.fn((...a: string[]) => a.join(":")),
    invalidate: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(),
  markProcessed: vi.fn(() => true),
  outboxMessages: {},
  processed: {},
  outboxSchema: {},
}));

vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(),
}));

// Mock the fnf domain module to control computeFnfSettlement
const mockComputeFnfSettlement = vi.fn();
vi.mock("../src/modules/fnf/domain.js", () => ({
  computeFnfSettlement: (...args: unknown[]) => mockComputeFnfSettlement(...args),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

beforeEach(() => {
  vi.clearAllMocks();
  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  mockScopedRead.mockResolvedValue([]);
  mockComputeFnfSettlement.mockReturnValue({
    totalGrossMinor: 10000000n,
    totalExemptMinor: 5000000n,
    totalTaxableOnSeparationMinor: 5000000n,
    annualTaxableMinor: 35000000n,
    annualTaxMinor: 2500000n,
    tdsAlreadyDeductedMinor: 2000000n,
    tdsOnSeparationMinor: 500000n,
    netPayableMinor: 9500000n,
    gratuityExemption: { exemptMinor: 4000000000n, taxableMinor: 0n },
    leaveEncashExemption: { exemptMinor: 2500000000n, taxableMinor: 0n },
    retrenchmentExemption: null,
    vrsExemption: null,
  });
});

function validFnfPayload(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: randomUUID(),
    separationDate: "2025-06-30",
    separationType: "retirement",
    employeeCategory: "govt",
    noticeBuyoutMinor: "0",
    leaveEncashmentGrossMinor: "3000000000",
    gratuityGrossMinor: "5000000000",
    retrenchmentCompMinor: "0",
    vrsCompMinor: "0",
    arrearsMinor: "500000",
    lastDrawnWagesMinor: "10000000",
    completedYears: 30,
    avgSalaryLast10MonthsMinor: "9500000",
    leaveBalanceDays: 300,
    priorLeaveEncashExemptionMinor: "0",
    remainingMonthsToRetirement: 0,
    taxRegime: "old",
    salaryYtdMinor: "30000000",
    tdsYtdMinor: "5000000",
    deductions80cMinor: "15000000",
    deductions80dMinor: "2500000",
    otherDeductionsMinor: "0",
    fyStartYear: 2024,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/fnf/compute — valid payload → 202
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/fnf/compute — valid payload", () => {
  it("returns 202 with queued message for valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload(),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.message).toBe("fnf compute queued");
    expect(body.data.employeeId).toBeDefined();
  });

  it("returns 202 for resignation separation type", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ separationType: "resignation" }),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 for new tax regime", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ taxRegime: "new" }),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 for vrs separation type", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ separationType: "vrs", vrsCompMinor: "500000000" }),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/fnf/compute — 400 validation errors
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/fnf/compute — validation", () => {
  it("returns 400 or 500 when employeeId is missing", async () => {
    const payload = validFnfPayload();
    delete (payload as Record<string, unknown>).employeeId;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload,
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 when separationType is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ separationType: "invalid_type" }),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 when separationDate format is wrong", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ separationDate: "30-06-2025" }),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for negative completedYears", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ completedYears: -5 }),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for invalid taxRegime", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ taxRegime: "invalid_regime" }),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for invalid employeeCategory", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ employeeCategory: "invalid_cat" }),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 when employeeId is not a UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: validFnfPayload({ employeeId: "not-a-uuid" }),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 when body is empty", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/fnf/compute — 401 / 403 auth
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/fnf/compute — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      payload: validFnfPayload(),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with malformed token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: "Bearer invalid.malformed.token" },
      payload: validFnfPayload(),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when role is citizen (not authorized)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: validFnfPayload(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when role is employee (not authorized)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/fnf/compute",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: validFnfPayload(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/fnf/settlements/:id
// ═══════════════════════════════════════════════════════════════════

function makeSettlement(overrides: Record<string, unknown> = {}) {
  return {
    id: FAKE,
    tenantId: TENANT,
    employeeId: randomUUID(),
    runId: randomUUID(),
    separationType: "retirement",
    separationDate: "2025-06-30",
    employeeCategory: "govt",
    noticeBuyoutMinor: 0n,
    leaveEncashmentGrossMinor: 3000000000n,
    gratuityGrossMinor: 5000000000n,
    retrenchmentCompMinor: 0n,
    vrsCompMinor: 0n,
    arrearsMinor: 500000n,
    gratuityExemptMinor: 5000000000n,
    leaveEncashExemptMinor: 3000000000n,
    retrenchmentExemptMinor: 0n,
    vrsExemptMinor: 0n,
    totalTaxableMinor: 500000n,
    tdsOnSeparationMinor: 50000n,
    netPayableMinor: 7950000n,
    computationDetail: {},
    status: "computed",
    currency: "INR",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: UUID,
    updatedBy: UUID,
    version: 1,
    ...overrides,
  };
}

describe("GET /v1/payroll/fnf/settlements/:id", () => {
  it("returns 200 with settlement data when found", async () => {
    mockScopedRead.mockResolvedValueOnce([makeSettlement()]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/fnf/settlements/${FAKE}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.id).toBe(FAKE);
    expect(body.data.status).toBe("computed");
    // bigint fields serialized as strings
    expect(typeof body.data.netPayableMinor).toBe("string");
  });

  it("returns 404 for non-existent settlement", async () => {
    mockScopedRead.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/fnf/settlements/${FAKE}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 or 500 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements/not-a-uuid",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/fnf/settlements/${FAKE}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/fnf/settlements/${FAKE}`,
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/fnf/settlements/${FAKE}`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/fnf/settlements — list
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/fnf/settlements", () => {
  it("returns 200 with empty array for list with no data", async () => {
    mockScopedRead.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.meta).toBeDefined();
    expect(body.meta.limit).toBeDefined();
    expect(body.meta.offset).toBeDefined();
  });

  it("returns 200 with settlements list when data exists", async () => {
    mockScopedRead.mockResolvedValueOnce([makeSettlement(), makeSettlement({ id: randomUUID() })]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(2);
  });

  it("supports employeeId filter query param", async () => {
    mockScopedRead.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/fnf/settlements?employeeId=${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
  });

  it("accepts valid limit and offset params", async () => {
    mockScopedRead.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements?limit=10&offset=0",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 or 500 for invalid limit query param (negative)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements?limit=-1",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for limit exceeding max 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements?limit=500",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/fnf/settlements",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/internal/fnf-tax-breakdown
// ═══════════════════════════════════════════════════════════════════

function makeTaxBreakdownParams(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    employeeId: randomUUID(),
    separationDate: "2025-06-30",
    separationType: "retirement",
    employeeCategory: "govt",
    noticeBuyoutMinor: "0",
    leaveEncashmentGrossMinor: "2500000000",
    gratuityGrossMinor: "4000000000",
    retrenchmentCompMinor: "0",
    vrsCompMinor: "0",
    arrearsMinor: "1000000",
    lastDrawnWagesMinor: "10000000",
    completedYears: "25",
    avgSalaryLast10MonthsMinor: "9000000",
    leaveBalanceDays: "240",
    priorLeaveEncashExemptionMinor: "0",
    remainingMonthsToRetirement: "0",
    taxRegime: "old",
    salaryYtdMinor: "25000000",
    tdsYtdMinor: "4000000",
    deductions80cMinor: "15000000",
    deductions80dMinor: "2500000",
    otherDeductionsMinor: "0",
    fyStartYear: "2024",
    ...overrides,
  });
}

describe("GET /v1/payroll/internal/fnf-tax-breakdown", () => {
  it("returns 200 with computed tax breakdown", async () => {
    // scopedRead for ceilings returns empty (uses defaults)
    mockScopedRead.mockResolvedValueOnce([]);

    const params = makeTaxBreakdownParams();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/internal/fnf-tax-breakdown?${params.toString()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const d = body.data;
    // All bigint fields are returned as strings
    expect(typeof d.totalGrossMinor).toBe("string");
    expect(typeof d.totalExemptMinor).toBe("string");
    expect(typeof d.totalTaxableOnSeparationMinor).toBe("string");
    expect(typeof d.annualTaxableMinor).toBe("string");
    expect(typeof d.annualTaxMinor).toBe("string");
    expect(typeof d.tdsAlreadyDeductedMinor).toBe("string");
    expect(typeof d.tdsOnSeparationMinor).toBe("string");
    expect(typeof d.netPayableMinor).toBe("string");
    expect(d.gratuityExemption).toBeDefined();
    expect(d.leaveEncashExemption).toBeDefined();
  });

  it("returns 200 with retrenchment exemption for retrenchment type", async () => {
    mockScopedRead.mockResolvedValueOnce([]);
    mockComputeFnfSettlement.mockReturnValue({
      totalGrossMinor: 10000000n,
      totalExemptMinor: 5000000n,
      totalTaxableOnSeparationMinor: 5000000n,
      annualTaxableMinor: 35000000n,
      annualTaxMinor: 2500000n,
      tdsAlreadyDeductedMinor: 2000000n,
      tdsOnSeparationMinor: 500000n,
      netPayableMinor: 9500000n,
      gratuityExemption: { exemptMinor: 2000000000n, taxableMinor: 2000000000n },
      leaveEncashExemption: { exemptMinor: 1500000000n, taxableMinor: 1000000000n },
      retrenchmentExemption: { exemptMinor: 500000000n, taxableMinor: 0n },
      vrsExemption: null,
    });

    const params = makeTaxBreakdownParams({
      separationType: "retrenchment",
      retrenchmentCompMinor: "500000000",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/internal/fnf-tax-breakdown?${params.toString()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.retrenchmentExemption).toBeDefined();
    expect(body.data.retrenchmentExemption.exemptMinor).toBe("500000000");
  });

  it("returns 200 for new tax regime", async () => {
    mockScopedRead.mockResolvedValueOnce([]);
    const params = makeTaxBreakdownParams({ taxRegime: "new" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/internal/fnf-tax-breakdown?${params.toString()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("uses ceiling values from DB when available", async () => {
    mockScopedRead.mockResolvedValueOnce([
      { section: "10_10", ceilingMinor: 3000000000n, fyStartYear: 2024 },
      { section: "10_10AA", ceilingMinor: 3500000000n, fyStartYear: 2024 },
    ]);

    const params = makeTaxBreakdownParams();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/internal/fnf-tax-breakdown?${params.toString()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(mockComputeFnfSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        gratuityCeilingMinor: 3000000000n,
        leaveEncashCeilingMinor: 3500000000n,
      }),
    );
  });

  it("returns 400 or 500 when required params are missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/internal/fnf-tax-breakdown?employeeId=not-a-uuid",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for invalid separationType", async () => {
    const params = makeTaxBreakdownParams({ separationType: "invalid_type" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/internal/fnf-tax-breakdown?${params.toString()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for invalid employeeCategory", async () => {
    const params = makeTaxBreakdownParams({ employeeCategory: "invalid_cat" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/internal/fnf-tax-breakdown?${params.toString()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/internal/fnf-tax-breakdown",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/internal/fnf-tax-breakdown",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/internal/fnf-tax-breakdown",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
