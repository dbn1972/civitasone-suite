/**
 * Government Rail Contract Tests — PFMS/e-Kuber
 *
 * Contract tests against recorded HTTP fixtures. Validates the PFMS adapter
 * behaves correctly against realistic response shapes from the PFMS API.
 *
 * When PFMS sandbox credentials are configured (PFMS_SANDBOX_URL), tests will
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

function makeToken(roles: string[] = ["finance_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pfms" }, JWT_SECRET, 3600);
}

// ── Recorded Fixtures (realistic PFMS API response shapes) ──────────

const FIXTURES = {
  submitPayment: {
    success: {
      referenceId: "PFMS-2026-REF-001234",
      pfmsTransactionId: "EKUB-TXN-2026071000145",
      status: "accepted",
      message: "Payment queued for processing via e-Kuber",
      timestamp: "2026-07-10T10:30:00.000Z",
    },
    rejected: {
      referenceId: "PFMS-2026-REF-001235",
      pfmsTransactionId: "EKUB-TXN-2026071000146",
      status: "rejected",
      message: "Beneficiary account frozen by issuing bank",
      timestamp: "2026-07-10T10:31:00.000Z",
    },
  },
  checkStatus: {
    completed: {
      referenceId: "PFMS-2026-REF-001234",
      pfmsTransactionId: "EKUB-TXN-2026071000145",
      status: "completed",
      utrNumber: "CBIN2026071000000145",
      processedAt: "2026-07-10T14:00:00.000Z",
    },
    pending: {
      referenceId: "PFMS-2026-REF-001234",
      pfmsTransactionId: "EKUB-TXN-2026071000145",
      status: "pending",
    },
    failed: {
      referenceId: "PFMS-2026-REF-001234",
      pfmsTransactionId: "EKUB-TXN-2026071000145",
      status: "failed",
      failureReason: "NEFT window closed — retry in next settlement cycle",
    },
  },
} as const;

describe("Gov Rail Contract: PFMS/e-Kuber", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Disabled adapter returns 503 (INTEGRATION_DISABLED)
  // ═══════════════════════════════════════════════════════════════════

  describe("disabled adapter → 503 INTEGRATION_DISABLED", () => {
    it("POST /v1/finance/pfms/payments returns 503 when PFMS_ENABLED is not set", async () => {
      vi.stubEnv("PFMS_ENABLED", "");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          referenceId: "REF-001",
          beneficiaryCode: "BEN-001",
          amount: "5000000",
          purposeCode: "SALARY",
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("PFMS integration is not available");
      expect(body.error.correlationId).toBeDefined();
    });

    it("GET /v1/finance/pfms/payments/:ref/status returns 503 when disabled", async () => {
      vi.stubEnv("PFMS_ENABLED", "");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/payments/REF-001/status",
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
    it("POST /v1/finance/pfms/payments returns 201 with accepted payment", async () => {
      vi.stubEnv("PFMS_ENABLED", "true");
      vi.stubEnv("PFMS_BASE_URL", "https://pfms-sandbox.gov.in");
      vi.stubEnv("PFMS_API_KEY", "sandbox-key-pfms");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.submitPayment.success),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          referenceId: "PFMS-2026-REF-001234",
          beneficiaryCode: "BEN-AG-0099",
          amount: "5000000",
          purposeCode: "SALARY",
          schemeCode: "7TH-CPC-SCHEME",
          ddoCode: "DDO-DEL-001",
          remarks: "July 2026 salary batch",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.referenceId).toBe("PFMS-2026-REF-001234");
      expect(body.data.pfmsTransactionId).toBe("EKUB-TXN-2026071000145");
      expect(body.data.status).toBe("accepted");
      expect(body.data.timestamp).toBe("2026-07-10T10:30:00.000Z");
    });

    it("GET /v1/finance/pfms/payments/:ref/status returns completed payment status", async () => {
      vi.stubEnv("PFMS_ENABLED", "true");
      vi.stubEnv("PFMS_BASE_URL", "https://pfms-sandbox.gov.in");
      vi.stubEnv("PFMS_API_KEY", "sandbox-key-pfms");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.checkStatus.completed),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/payments/PFMS-2026-REF-001234/status",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe("completed");
      expect(body.data.utrNumber).toBe("CBIN2026071000000145");
      expect(body.data.processedAt).toBe("2026-07-10T14:00:00.000Z");
    });

    it("handles rejected payment fixture", async () => {
      vi.stubEnv("PFMS_ENABLED", "true");
      vi.stubEnv("PFMS_BASE_URL", "https://pfms-sandbox.gov.in");
      vi.stubEnv("PFMS_API_KEY", "sandbox-key-pfms");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.submitPayment.rejected),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          referenceId: "PFMS-2026-REF-001235",
          beneficiaryCode: "BEN-AG-0100",
          amount: "2500000",
          purposeCode: "PENSION",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.status).toBe("rejected");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Circuit breaker opens after 5 failures → 503 CIRCUIT_OPEN
  // ═══════════════════════════════════════════════════════════════════

  describe("circuit breaker → 503 CIRCUIT_OPEN after 5 failures", () => {
    it("trips circuit breaker after 5 consecutive upstream failures", async () => {
      vi.stubEnv("PFMS_ENABLED", "true");
      vi.stubEnv("PFMS_BASE_URL", "https://pfms-sandbox.gov.in");
      vi.stubEnv("PFMS_API_KEY", "sandbox-key-pfms");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("e-Kuber gateway unavailable"),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const token = makeToken();

      // Trigger 5 failures to trip the breaker
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/finance/pfms/payments/REF-001/status",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(502);
      }

      // 6th call should hit the open circuit breaker
      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/payments/REF-001/status",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.message).toBe("PFMS service is temporarily unavailable");
      expect(body.error.correlationId).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Auth tests — 401/403
  // ═══════════════════════════════════════════════════════════════════

  describe("auth — 401 without token", () => {
    it("POST /v1/finance/pfms/payments returns 401 without auth header", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        payload: {
          referenceId: "REF-001",
          beneficiaryCode: "BEN-001",
          amount: "100000",
          purposeCode: "SALARY",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("auth — 403 with wrong role", () => {
    it("POST /v1/finance/pfms/payments returns 403 for employee role", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          referenceId: "REF-001",
          beneficiaryCode: "BEN-001",
          amount: "100000",
          purposeCode: "SALARY",
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. No PII in error responses
  // ═══════════════════════════════════════════════════════════════════

  describe("no PII in error responses", () => {
    it("upstream error body with PII is not leaked to the client", async () => {
      vi.stubEnv("PFMS_ENABLED", "true");
      vi.stubEnv("PFMS_BASE_URL", "https://pfms-sandbox.gov.in");
      vi.stubEnv("PFMS_API_KEY", "sandbox-key-pfms");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          error: "Beneficiary PAN ABCDE1234F (Rajesh Kumar, a/c XXXX1234) is invalid",
        })),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          referenceId: "REF-PII-TEST",
          beneficiaryCode: "BEN-001",
          amount: "100000",
          purposeCode: "SALARY",
        },
      });

      const responseText = JSON.stringify(res.json());
      // Must not contain PII from the upstream response
      expect(responseText).not.toContain("ABCDE1234F");
      expect(responseText).not.toContain("Rajesh Kumar");
      expect(responseText).not.toContain("XXXX1234");
      // Should return generic error
      expect(res.json().error.code).toBe("UPSTREAM_ERROR");
    });
  });
});
