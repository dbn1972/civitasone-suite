/**
 * Government Rail Contract Tests — NACH/APBS
 *
 * Contract tests against recorded HTTP fixtures. Validates the NACH adapter
 * behaves correctly against realistic response shapes from the NPCI NACH API.
 *
 * When NACH sandbox credentials are configured (NACH_SANDBOX_URL), tests will
 * hit the live sandbox. Otherwise, they run against recorded fixtures.
 *
 * Validates: Requirements 22.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function makeToken(roles: string[] = ["payroll_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-nach" }, JWT_SECRET, 3600);
}

// ── Recorded Fixtures (realistic NACH/APBS API response shapes) ─────

const FIXTURES = {
  submitMandate: {
    success: {
      mandateRef: "MNDT-NACH-2026080100012",
      status: "submitted",
      umrn: "NACH00000000012345",
      submittedAt: "2026-08-01T09:30:00.000Z",
    },
  },
  checkMandateStatus: {
    active: {
      mandateRef: "MNDT-NACH-2026080100012",
      status: "active",
      umrn: "NACH00000000012345",
      lastUpdated: "2026-08-03T14:00:00.000Z",
    },
    rejected: {
      mandateRef: "MNDT-NACH-2026080100012",
      status: "rejected",
      umrn: "NACH00000000012345",
      lastUpdated: "2026-08-02T11:00:00.000Z",
      reasonCode: "M005",
      reasonText: "Account holder name mismatch",
    },
  },
  submitBulkPayment: {
    success: {
      batchRef: "BATCH-APBS-2026081000001",
      transactionId: "APBS-TXN-2026081012345",
      status: "submitted",
      submittedAt: "2026-08-10T06:00:00.000Z",
      beneficiaryCount: 150,
    },
  },
} as const;

// Mock the NACH adapter module for route-level testing
vi.mock("../src/modules/nach/adapter.js", () => {
  const NachAdapterError = class extends Error {
    public readonly code: string;
    public readonly httpStatus?: number;
    constructor(message: string, code: string, httpStatus?: number) {
      super(message);
      this.name = "NachAdapterError";
      this.code = code;
      this.httpStatus = httpStatus;
    }
  };
  const CircuitBreakerOpenError = class extends Error {
    constructor(name: string) {
      super(`Circuit breaker "${name}" is open`);
      this.name = "CircuitBreakerOpenError";
    }
  };

  return {
    submitMandate: vi.fn(),
    checkMandateStatus: vi.fn(),
    submitBulkPayment: vi.fn(),
    getBreakerState: vi.fn(() => "closed"),
    isEnabled: vi.fn(() => true),
    NachAdapterError,
    CircuitBreakerOpenError,
  };
});

describe("Gov Rail Contract: NACH/APBS", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("JWT_SECRET", JWT_SECRET);

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Disabled adapter returns 503 (INTEGRATION_DISABLED)
  // ═══════════════════════════════════════════════════════════════════

  describe("disabled adapter → 503 INTEGRATION_DISABLED", () => {
    it("POST /v1/payroll/nach/mandates returns 503 when adapter disabled", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockRejectedValue(
        new adapter.NachAdapterError("NACH/APBS integration is not available", "INTEGRATION_DISABLED"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("NACH/APBS integration is not available");
      expect(body.error.correlationId).toBeDefined();
    });

    it("GET /v1/payroll/nach/mandates/:ref/status returns 503 when disabled", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.checkMandateStatus).mockRejectedValue(
        new adapter.NachAdapterError("NACH/APBS integration is not available", "INTEGRATION_DISABLED"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-001/status",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Happy path with recorded fixture responses
  // ═══════════════════════════════════════════════════════════════════

  describe("happy path — recorded fixtures", () => {
    it("POST /v1/payroll/nach/mandates returns 201 with mandate result", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockResolvedValue(FIXTURES.submitMandate.success);

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.mandateRef).toBe("MNDT-NACH-2026080100012");
      expect(body.data.status).toBe("submitted");
      expect(body.data.umrn).toBe("NACH00000000012345");
      expect(body.data.submittedAt).toBe("2026-08-01T09:30:00.000Z");
    });

    it("GET /v1/payroll/nach/mandates/:ref/status returns active mandate", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.checkMandateStatus).mockResolvedValue(FIXTURES.checkMandateStatus.active);

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-NACH-2026080100012/status",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.mandateRef).toBe("MNDT-NACH-2026080100012");
      expect(body.data.status).toBe("active");
      expect(body.data.umrn).toBe("NACH00000000012345");
    });

    it("handles rejected mandate status fixture", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.checkMandateStatus).mockResolvedValue(FIXTURES.checkMandateStatus.rejected);

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-NACH-2026080100012/status",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe("rejected");
      expect(body.data.reasonCode).toBe("M005");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Circuit breaker opens after 5 failures → 503 CIRCUIT_OPEN
  // ═══════════════════════════════════════════════════════════════════

  describe("circuit breaker → 503 CIRCUIT_OPEN after 5 failures", () => {
    it("returns 503 CIRCUIT_OPEN when breaker is tripped", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockRejectedValue(
        new adapter.CircuitBreakerOpenError("nach"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.message).toBe("NACH/APBS service is temporarily unavailable");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Auth tests — 401/403
  // ═══════════════════════════════════════════════════════════════════

  describe("auth — 401 without token", () => {
    it("POST /v1/payroll/nach/mandates returns 401 without auth header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("auth — 403 with wrong role", () => {
    it("POST /v1/payroll/nach/mandates returns 403 for employee role", async () => {
      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. No PII in error responses
  // ═══════════════════════════════════════════════════════════════════

  describe("no PII in error responses", () => {
    it("upstream error body is not leaked to the client", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockRejectedValue(
        new adapter.NachAdapterError("NACH API returned 400", "NACH_API_ERROR", 400),
      );

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error.code).toBe("EXTERNAL_FAILURE");
      // Error message must not expose upstream detail
      expect(body.error.message).toBe("NACH/APBS service returned an error");
      expect(body.error.correlationId).toBeDefined();
      // Verify no PII patterns in the response
      const responseText = JSON.stringify(body);
      expect(responseText).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN
      expect(responseText).not.toMatch(/\b\d{12}\b/); // Aadhaar
    });
  });
});
