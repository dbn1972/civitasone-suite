/**
 * Integration tests for F&F calculate endpoint with tax breakdown from payroll-service.
 *
 * Tests:
 * 1. Graceful degradation when payroll-service unavailable (warning returned)
 * 2. Successful tax breakdown included when payroll-client returns data
 * 3. Govt employee: fully exempt gratuity/leave encashment
 * 4. Private employee: partial exemptions
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";

// Mock the payroll-client before importing app
const mockFetchFnfTaxBreakdown = vi.fn();

class MockPayrollUnavailableError extends Error {
  readonly code = "PAYROLL_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "PayrollUnavailableError";
  }
}

vi.mock("../src/shared/payroll-client.js", () => ({
  fetchFnfTaxBreakdown: mockFetchFnfTaxBreakdown,
  PayrollUnavailableError: MockPayrollUnavailableError,
}));

// Mock DB to provide controlled employee/leave data without needing a real database
const mockWhereResult = vi.fn();

vi.mock("../src/shared/db.js", () => {
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockWhereResult()),
      })),
    })),
  };
  return {
    db: mockDb,
    sqlClient: { end: vi.fn() },
    // scopedRead runs reads under db.transaction() in production so RLS's
    // app.tenant_id GUC is set. In this mocked-db test, there's no real
    // transaction/connection, so just invoke the callback directly with the
    // same mocked query builder.
    scopedRead: vi.fn((fn: (tx: typeof mockDb) => unknown) => fn(mockDb)),
  };
});

// Mock infra (cache/queue) to avoid real connections
vi.mock("../src/shared/infra.js", () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), getOrLoad: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn() },
}));

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const EMPLOYEE_ID = "aaaaaaaa-2222-4000-8000-000000000001";

function mintToken(roles: string[] = ["hr_admin"]) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: "aaaaaaaa-3333-4000-8000-000000000001",
    iss: "civitasone-dev",
    tid: TENANT,
    tenantId: TENANT,
    sid: "test-session",
    email: "hr@test.dev",
    name: "HR Admin",
    roles,
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// Employee joined 2015-01-01 → ~10 years of service, basic ₹1,00,000 (10000000 paise)
const MOCK_EMPLOYEE = {
  id: EMPLOYEE_ID,
  tenantId: TENANT,
  employeeNo: "EMP001",
  fullName: "Test Employee",
  dateOfJoining: "2015-01-01",
  basicMinor: 10000000n, // ₹1,00,000 in paise
  currency: "INR",
};

// 30 days leave balance total (20 + 10)
const MOCK_LEAVE_ALLOCS = [
  { tenantId: TENANT, employeeId: EMPLOYEE_ID, balanceDays: 20 },
  { tenantId: TENANT, employeeId: EMPLOYEE_ID, balanceDays: 10 },
];

/**
 * Sets up DB mock to return employee on first call (with .limit()) and
 * leave allocations on second call.
 */
function setupDbReturns() {
  let callCount = 0;
  mockWhereResult.mockImplementation(() => {
    callCount++;
    if (callCount % 2 === 1) {
      // Employee query (has .limit())
      return { limit: vi.fn().mockResolvedValue([MOCK_EMPLOYEE]) };
    }
    // Leave allocations query (no .limit(), returns array directly)
    return Promise.resolve(MOCK_LEAVE_ALLOCS);
  });
}

describe("F&F Calculate — Tax Breakdown Integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const FNF_URL = `/v1/hrms/employees/${EMPLOYEE_ID}/fnf-calculate`;
  const BASE_BODY = {
    separationDate: "2025-06-15",
    noticePeriodDays: 90,
    noticeDaysServed: 30,
    separationType: "retirement",
    employeeCategory: "non_govt_covered",
    taxRegime: "new",
  };

  describe("1. Payroll-service unavailable (graceful degradation)", () => {
    it("returns response with warning and no taxBreakdown when payroll-service is down", async () => {
      setupDbReturns();
      mockFetchFnfTaxBreakdown.mockRejectedValue(
        new MockPayrollUnavailableError("payroll-service unreachable: connect ECONNREFUSED"),
      );

      const res = await app.inject({
        method: "POST",
        url: FNF_URL,
        headers: {
          authorization: `Bearer ${mintToken()}`,
          "content-type": "application/json",
        },
        payload: BASE_BODY,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Should have breakdown and total
      expect(body).toHaveProperty("breakdown");
      expect(body).toHaveProperty("totalFnfMinor");
      expect(body.breakdown).toHaveProperty("noticeBuyout");
      expect(body.breakdown).toHaveProperty("leaveEncashment");
      expect(body.breakdown).toHaveProperty("gratuity");

      // Should have warning, no taxBreakdown
      expect(body.warning).toBe("Tax computation unavailable");
      expect(body.taxBreakdown).toBeUndefined();
    });
  });

  describe("2. Mocked payroll response includes taxBreakdown", () => {
    it("returns taxBreakdown with components and totals on successful payroll response", async () => {
      setupDbReturns();
      mockFetchFnfTaxBreakdown.mockResolvedValue({
        totalGrossMinor: "16666667",
        totalExemptMinor: "10000000",
        totalTaxableOnSeparationMinor: "6666667",
        annualTaxableMinor: "1500000000",
        annualTaxMinor: "300000000",
        tdsAlreadyDeductedMinor: "0",
        tdsOnSeparationMinor: "300000000",
        netPayableMinor: "13666667",
        gratuityExemption: { exemptMinor: "5769231", taxableMinor: "0" },
        leaveEncashExemption: { exemptMinor: "4000000", taxableMinor: "6000000" },
        retrenchmentExemption: null,
        vrsExemption: null,
      });

      const res = await app.inject({
        method: "POST",
        url: FNF_URL,
        headers: {
          authorization: `Bearer ${mintToken()}`,
          "content-type": "application/json",
        },
        payload: BASE_BODY,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Should NOT have warning
      expect(body.warning).toBeUndefined();

      // Should have taxBreakdown
      expect(body.taxBreakdown).toBeDefined();
      expect(body.taxBreakdown.components).toBeInstanceOf(Array);
      expect(body.taxBreakdown.components.length).toBeGreaterThanOrEqual(3);

      // Verify component names present
      const componentNames = body.taxBreakdown.components.map((c: { name: string }) => c.name);
      expect(componentNames).toContain("gratuity");
      expect(componentNames).toContain("leaveEncashment");
      expect(componentNames).toContain("noticeBuyout");

      // Verify each component has required fields
      for (const comp of body.taxBreakdown.components) {
        expect(comp).toHaveProperty("grossMinor");
        expect(comp).toHaveProperty("exemptMinor");
        expect(comp).toHaveProperty("taxableMinor");
        expect(comp).toHaveProperty("section");
        expect(comp).toHaveProperty("reason");
      }

      // Verify totals
      expect(body.taxBreakdown).toHaveProperty("totalTaxableOnSeparationMinor");
      expect(body.taxBreakdown).toHaveProperty("estimatedTdsOnSeparationMinor");
      expect(body.taxBreakdown).toHaveProperty("totalExemptMinor");
      expect(body.taxBreakdown).toHaveProperty("annualTaxableMinor");
      expect(body.taxBreakdown).toHaveProperty("netPayableMinor");
    });
  });

  describe("3. Govt employee: fully exempt gratuity and leave encashment", () => {
    it("shows exemptMinor = grossMinor for gratuity and leave encashment", async () => {
      setupDbReturns();

      // Computed from route logic with mock employee:
      // gratuity = round((10000000 * 15 * 10) / 26) = 57692308 paise
      // leaveEncash = round(10000000/30) * 30 = 10000000 paise (333333 * 30 = 9999990 actually)
      // For govt employee, gratuity and leave encash are fully exempt (taxable = 0)
      // The exemptMinor must equal the computed grossMinor for "fully exempt"
      const expectedGratuityGross = String(Math.round((10000000 * 15 * 10) / 26)); // "57692308"
      const dailyBasic = Math.round(10000000 / 30); // 333333
      const expectedLeaveGross = String(dailyBasic * 30); // "9999990"

      mockFetchFnfTaxBreakdown.mockResolvedValue({
        totalGrossMinor: "67692298",
        totalExemptMinor: "67692298",
        totalTaxableOnSeparationMinor: "0",
        annualTaxableMinor: "0",
        annualTaxMinor: "0",
        tdsAlreadyDeductedMinor: "0",
        tdsOnSeparationMinor: "0",
        netPayableMinor: "67692298",
        gratuityExemption: { exemptMinor: expectedGratuityGross, taxableMinor: "0" },
        leaveEncashExemption: { exemptMinor: expectedLeaveGross, taxableMinor: "0" },
        retrenchmentExemption: null,
        vrsExemption: null,
      });

      const res = await app.inject({
        method: "POST",
        url: FNF_URL,
        headers: {
          authorization: `Bearer ${mintToken()}`,
          "content-type": "application/json",
        },
        payload: { ...BASE_BODY, employeeCategory: "govt", separationType: "retirement" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.taxBreakdown).toBeDefined();

      const gratuityComp = body.taxBreakdown.components.find(
        (c: { name: string }) => c.name === "gratuity",
      );
      const leaveComp = body.taxBreakdown.components.find(
        (c: { name: string }) => c.name === "leaveEncashment",
      );

      // Govt employee: gratuity fully exempt (exemptMinor = grossMinor)
      expect(gratuityComp).toBeDefined();
      expect(gratuityComp.exemptMinor).toBe(expectedGratuityGross);
      expect(gratuityComp.taxableMinor).toBe("0");
      expect(gratuityComp.grossMinor).toBe(gratuityComp.exemptMinor);

      // Govt employee: leave encashment fully exempt (exemptMinor = grossMinor)
      expect(leaveComp).toBeDefined();
      expect(leaveComp.exemptMinor).toBe(expectedLeaveGross);
      expect(leaveComp.taxableMinor).toBe("0");
      expect(leaveComp.grossMinor).toBe(leaveComp.exemptMinor);
    });
  });

  describe("4. Private employee: partial exemptions", () => {
    it("shows taxableMinor > 0 for components with partial exemptions", async () => {
      setupDbReturns();

      // Private (non-govt) employee: partial exemptions apply
      mockFetchFnfTaxBreakdown.mockResolvedValue({
        totalGrossMinor: "26666667",
        totalExemptMinor: "12000000",
        totalTaxableOnSeparationMinor: "14666667",
        annualTaxableMinor: "2000000000",
        annualTaxMinor: "500000000",
        tdsAlreadyDeductedMinor: "100000000",
        tdsOnSeparationMinor: "400000000",
        netPayableMinor: "22666667",
        // Gratuity: partial exemption (formula capped below actual)
        gratuityExemption: { exemptMinor: "5000000", taxableMinor: "769231" },
        // Leave: partial exemption (ceiling-limited)
        leaveEncashExemption: { exemptMinor: "7000000", taxableMinor: "3000000" },
        retrenchmentExemption: null,
        vrsExemption: null,
      });

      const res = await app.inject({
        method: "POST",
        url: FNF_URL,
        headers: {
          authorization: `Bearer ${mintToken()}`,
          "content-type": "application/json",
        },
        payload: { ...BASE_BODY, employeeCategory: "non_govt_covered", separationType: "resignation" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.taxBreakdown).toBeDefined();

      const gratuityComp = body.taxBreakdown.components.find(
        (c: { name: string }) => c.name === "gratuity",
      );
      const leaveComp = body.taxBreakdown.components.find(
        (c: { name: string }) => c.name === "leaveEncashment",
      );
      const noticeComp = body.taxBreakdown.components.find(
        (c: { name: string }) => c.name === "noticeBuyout",
      );

      // Private employee: gratuity partially exempt
      expect(gratuityComp).toBeDefined();
      expect(Number(gratuityComp.taxableMinor)).toBeGreaterThan(0);
      expect(Number(gratuityComp.exemptMinor)).toBeGreaterThan(0);
      expect(Number(gratuityComp.exemptMinor)).toBeLessThan(Number(gratuityComp.grossMinor));

      // Private employee: leave encashment partially exempt
      expect(leaveComp).toBeDefined();
      expect(Number(leaveComp.taxableMinor)).toBeGreaterThan(0);
      expect(Number(leaveComp.exemptMinor)).toBeGreaterThan(0);

      // Notice buyout: always fully taxable (no exemption)
      expect(noticeComp).toBeDefined();
      expect(noticeComp.exemptMinor).toBe("0");
      expect(noticeComp.taxableMinor).toBe(noticeComp.grossMinor);
    });
  });
});
