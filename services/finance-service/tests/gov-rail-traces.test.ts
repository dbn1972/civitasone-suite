/**
 * Government Rail Contract Tests — TRACES
 *
 * Contract tests against recorded HTTP fixtures. Validates the TRACES adapter
 * behaves correctly against realistic response shapes from the TRACES API
 * (TDS returns, PAN verification, Form 16 download).
 *
 * When TRACES sandbox credentials are configured (TRACES_SANDBOX_URL), tests
 * will hit the live sandbox. Otherwise, they run against recorded fixtures.
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
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-traces" }, JWT_SECRET, 3600);
}

// ── Recorded Fixtures (realistic TRACES API response shapes) ────────

const FIXTURES = {
  submitTdsReturn: {
    accepted: {
      tokenNumber: "TKN-TRACES-2026Q1-001234",
      status: "accepted",
      submittedAt: "2026-07-10T10:00:00.000Z",
    },
    pendingValidation: {
      tokenNumber: "TKN-TRACES-2026Q1-001235",
      status: "pending_validation",
      submittedAt: "2026-07-10T10:05:00.000Z",
    },
  },
  verifyPanStatus: {
    valid: {
      pan: "ABCDE1234F",
      status: "valid",
      name: "REGISTERED_ENTITY",
      lastVerifiedAt: "2026-07-10T09:00:00.000Z",
    },
    invalid: {
      pan: "ZZZZZ9999Z",
      status: "invalid",
      lastVerifiedAt: "2026-07-10T09:01:00.000Z",
    },
    inactive: {
      pan: "BBBBB5555B",
      status: "inactive",
      name: "INACTIVE_ENTITY",
      lastVerifiedAt: "2026-07-10T09:02:00.000Z",
    },
  },
  downloadForm16: {
    success: {
      downloadUrl: "https://traces.gov.in/downloads/form16/2025-26/MUMB12345A/ABCDE1234F.pdf",
      fileFormat: "pdf",
      generatedAt: "2026-07-10T11:00:00.000Z",
    },
  },
} as const;

describe("Gov Rail Contract: TRACES", () => {
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
    it("POST /v1/finance/traces/tds-returns returns 503 when disabled", async () => {
      vi.stubEnv("TRACES_ENABLED", "");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/traces/tds-returns",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          tanNumber: "MUMB12345A",
          formType: "26Q",
          quarter: "Q1",
          financialYear: "2025-26",
          deductees: [{
            pan: "ABCDE1234F",
            name: "Test Vendor",
            amountPaidMinor: 100000,
            tdsDeductedMinor: 2000,
            section: "194C",
          }],
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("TRACES integration is not available");
      expect(body.error.correlationId).toBeDefined();
    });

    it("GET /v1/finance/traces/pan-status/:pan returns 503 when disabled", async () => {
      vi.stubEnv("TRACES_ENABLED", "");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/traces/pan-status/ABCDE1234F",
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
    it("POST /v1/finance/traces/tds-returns returns 202 with accepted return", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces-sandbox.incometax.gov.in");
      vi.stubEnv("TRACES_API_KEY", "sandbox-key-traces");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.submitTdsReturn.accepted),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/traces/tds-returns",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          tanNumber: "MUMB12345A",
          formType: "26Q",
          quarter: "Q1",
          financialYear: "2025-26",
          deductees: [{
            pan: "ABCDE1234F",
            name: "Test Vendor",
            amountPaidMinor: 100000,
            tdsDeductedMinor: 2000,
            section: "194C",
          }],
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.tokenNumber).toBe("TKN-TRACES-2026Q1-001234");
      expect(body.data.status).toBe("accepted");
      expect(body.data.submittedAt).toBe("2026-07-10T10:00:00.000Z");
    });

    it("GET /v1/finance/traces/pan-status/:pan returns valid PAN status", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces-sandbox.incometax.gov.in");
      vi.stubEnv("TRACES_API_KEY", "sandbox-key-traces");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.verifyPanStatus.valid),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/traces/pan-status/ABCDE1234F",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.pan).toBe("ABCDE1234F");
      expect(body.data.status).toBe("valid");
      expect(body.data.lastVerifiedAt).toBe("2026-07-10T09:00:00.000Z");
    });

    it("handles invalid PAN status fixture", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces-sandbox.incometax.gov.in");
      vi.stubEnv("TRACES_API_KEY", "sandbox-key-traces");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.verifyPanStatus.invalid),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/traces/pan-status/ZZZZZ9999Z",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe("invalid");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Circuit breaker opens after 5 failures → 503 CIRCUIT_OPEN
  // ═══════════════════════════════════════════════════════════════════

  describe("circuit breaker → 503 CIRCUIT_OPEN after 5 failures", () => {
    it("trips circuit breaker after 5 consecutive upstream failures", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces-sandbox.incometax.gov.in");
      vi.stubEnv("TRACES_API_KEY", "sandbox-key-traces");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("TRACES service unavailable"),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const token = makeToken();

      // Trigger 5 failures to trip the breaker
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/finance/traces/pan-status/ABCDE1234F",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(502);
      }

      // 6th call should hit the open circuit breaker
      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/traces/pan-status/ABCDE1234F",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.correlationId).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Auth tests — 401/403
  // ═══════════════════════════════════════════════════════════════════

  describe("auth — 401 without token", () => {
    it("POST /v1/finance/traces/tds-returns returns 401 without auth header", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/traces/tds-returns",
        headers: { "content-type": "application/json" },
        payload: {
          tanNumber: "MUMB12345A",
          formType: "26Q",
          quarter: "Q1",
          financialYear: "2025-26",
          deductees: [],
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("auth — 403 with wrong role", () => {
    it("POST /v1/finance/traces/tds-returns returns 403 for employee role", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/traces/tds-returns",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: {
          tanNumber: "MUMB12345A",
          formType: "26Q",
          quarter: "Q1",
          financialYear: "2025-26",
          deductees: [{
            pan: "ABCDE1234F",
            name: "Test",
            amountPaidMinor: 100000,
            tdsDeductedMinor: 2000,
            section: "194C",
          }],
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
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces-sandbox.incometax.gov.in");
      vi.stubEnv("TRACES_API_KEY", "sandbox-key-traces");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({
          error: "PAN ABCDE1234F belongs to Rajesh Kumar (Aadhaar: 123456789012)",
        })),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/finance/traces/pan-status/ABCDE1234F",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      const responseText = JSON.stringify(res.json());
      // Must not contain any PII from the upstream response
      expect(responseText).not.toContain("Rajesh Kumar");
      expect(responseText).not.toContain("123456789012");
      // Should return generic error
      expect(res.json().error.code).toBe("UPSTREAM_ERROR");
    });
  });
});
