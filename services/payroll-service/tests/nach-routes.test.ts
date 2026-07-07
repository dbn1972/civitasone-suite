/**
 * payroll-service — NACH/APBS routes integration tests
 *
 * Covers:
 * - POST /v1/payroll/nach/mandates — disabled returns 503
 * - POST /v1/payroll/nach/mandates — happy path (mocked adapter)
 * - GET /v1/payroll/nach/mandates/:ref/status — disabled returns 503
 * - GET /v1/payroll/nach/mandates/:ref/status — happy path (mocked adapter)
 * - Circuit breaker 503
 * - 401 no token
 * - 403 wrong role
 * - 400 validation errors
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.6, 22.7
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function employeeToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}

// Mock the NACH adapter to control its behavior in route tests
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

describe("NACH/APBS routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /v1/payroll/nach/mandates — disabled (503)
  // ═══════════════════════════════════════════════════════════════

  describe("POST /v1/payroll/nach/mandates — disabled", () => {
    it("returns 503 INTEGRATION_DISABLED when adapter is not configured", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockRejectedValue(
        new adapter.NachAdapterError("NACH/APBS integration is not available", "INTEGRATION_DISABLED"),
      );

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("NACH/APBS integration is not available");
      expect(body.error.correlationId).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /v1/payroll/nach/mandates — happy path
  // ═══════════════════════════════════════════════════════════════

  describe("POST /v1/payroll/nach/mandates — happy path", () => {
    it("returns 201 with mandate result on successful submission", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockResolvedValue({
        mandateRef: "MNDT-2026-0001",
        status: "submitted",
        umrn: "UMRN12345678901234",
        submittedAt: "2026-08-01T10:00:00Z",
      });

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.mandateRef).toBe("MNDT-2026-0001");
      expect(body.data.status).toBe("submitted");
      expect(body.data.umrn).toBe("UMRN12345678901234");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /v1/payroll/nach/mandates/:ref/status — disabled (503)
  // ═══════════════════════════════════════════════════════════════

  describe("GET /v1/payroll/nach/mandates/:ref/status — disabled", () => {
    it("returns 503 INTEGRATION_DISABLED when adapter is not configured", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.checkMandateStatus).mockRejectedValue(
        new adapter.NachAdapterError("NACH/APBS integration is not available", "INTEGRATION_DISABLED"),
      );

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-2026-0001/status",
        headers: { authorization: `Bearer ${adminToken()}` },
      });
      await app.close();

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /v1/payroll/nach/mandates/:ref/status — happy path
  // ═══════════════════════════════════════════════════════════════

  describe("GET /v1/payroll/nach/mandates/:ref/status — happy path", () => {
    it("returns 200 with mandate status on successful lookup", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.checkMandateStatus).mockResolvedValue({
        mandateRef: "MNDT-2026-0001",
        status: "active",
        umrn: "UMRN12345678901234",
        lastUpdated: "2026-08-05T14:30:00Z",
      });

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-2026-0001/status",
        headers: { authorization: `Bearer ${adminToken()}` },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.mandateRef).toBe("MNDT-2026-0001");
      expect(body.data.status).toBe("active");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Circuit breaker — 503
  // ═══════════════════════════════════════════════════════════════

  describe("circuit breaker — 503", () => {
    it("returns 503 CIRCUIT_OPEN when breaker is tripped", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockRejectedValue(
        new adapter.CircuitBreakerOpenError("nach"),
      );

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.message).toBe("NACH/APBS service is temporarily unavailable");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Upstream error — 502
  // ═══════════════════════════════════════════════════════════════

  describe("upstream error — 502", () => {
    it("returns 502 EXTERNAL_FAILURE on upstream API error", async () => {
      const adapter = await import("../src/modules/nach/adapter.js");
      vi.mocked(adapter.submitMandate).mockRejectedValue(
        new adapter.NachAdapterError("NACH API returned 500", "NACH_API_ERROR", 500),
      );

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error.code).toBe("EXTERNAL_FAILURE");
      expect(body.error.correlationId).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Auth — 401 no token
  // ═══════════════════════════════════════════════════════════════

  describe("401 no token", () => {
    it("POST /v1/payroll/nach/mandates returns 401 without auth header", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

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
      await app.close();

      expect(res.statusCode).toBe(401);
    });

    it("GET /v1/payroll/nach/mandates/:ref/status returns 401 without auth header", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-001/status",
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Auth — 403 wrong role
  // ═══════════════════════════════════════════════════════════════

  describe("403 wrong role", () => {
    it("POST /v1/payroll/nach/mandates returns 403 for employee role", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${employeeToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });

    it("GET /v1/payroll/nach/mandates/:ref/status returns 403 for employee role", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/payroll/nach/mandates/MNDT-001/status",
        headers: { authorization: `Bearer ${employeeToken()}` },
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Validation — 400
  // ═══════════════════════════════════════════════════════════════

  describe("400 validation errors", () => {
    it("POST /v1/payroll/nach/mandates returns 400 for invalid frequency", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "invalid-freq",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("POST /v1/payroll/nach/mandates returns 400 for missing employeeRef", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("POST /v1/payroll/nach/mandates returns 400 for invalid date format", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/nach/mandates",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: {
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: "5000000",
          frequency: "monthly",
          startDate: "08-01-2026",
          endDate: "2027-07-31",
          accountType: "savings",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });
});
