/**
 * Government Rail Contract Tests — GSTN
 *
 * Contract tests against recorded HTTP fixtures. Validates the GSTN adapter
 * behaves correctly against realistic response shapes from the GST Network API
 * (GST return filing, GSTIN verification, return status).
 *
 * When GSTN sandbox credentials are configured (GSTN_SANDBOX_URL), tests will
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
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-gstn" }, JWT_SECRET, 3600);
}

// ── Recorded Fixtures (realistic GSTN API response shapes) ──────────

const FIXTURES = {
  submitGstReturn: {
    submitted: {
      referenceId: "GSTN-RET-2026-07-001234",
      status: "submitted",
      gstin: "22AAAAA0000A1Z5",
      returnPeriod: "07/2026",
      submittedAt: "2026-08-10T09:00:00.000Z",
    },
    processing: {
      referenceId: "GSTN-RET-2026-07-001235",
      status: "processing",
      gstin: "22AAAAA0000A1Z5",
      returnPeriod: "07/2026",
      submittedAt: "2026-08-10T09:05:00.000Z",
    },
  },
  verifyGstin: {
    active: {
      gstin: "22AAAAA0000A1Z5",
      legalName: "Government Department of Technology",
      tradeName: "Dept of IT",
      status: "active",
      registrationDate: "2017-07-01",
      lastUpdated: "2026-07-10T08:00:00.000Z",
    },
    cancelled: {
      gstin: "09BBBBB1111B2Y4",
      legalName: "Cancelled Entity Corp",
      tradeName: "CE Corp",
      status: "cancelled",
      registrationDate: "2018-04-01",
      lastUpdated: "2026-06-01T08:00:00.000Z",
    },
  },
  fetchReturnStatus: {
    filed: {
      referenceId: "GSTN-RET-2026-07-001234",
      status: "filed",
      returnPeriod: "07/2026",
      filedAt: "2026-08-11T10:00:00.000Z",
      lastUpdated: "2026-08-11T10:00:00.000Z",
    },
    rejected: {
      referenceId: "GSTN-RET-2026-07-001235",
      status: "rejected",
      returnPeriod: "07/2026",
      rejectionReason: "IGST amount mismatch with invoice summary",
      lastUpdated: "2026-08-10T15:00:00.000Z",
    },
  },
} as const;

describe("Gov Rail Contract: GSTN", () => {
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
    it("POST /v1/billing/gstn/returns returns 503 when GSTN_ENABLED is not set", async () => {
      vi.stubEnv("GSTN_ENABLED", "");
      vi.stubEnv("GSTN_BASE_URL", "");
      vi.stubEnv("GSTN_API_KEY", "");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/gstn/returns",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          gstin: "22AAAAA0000A1Z5",
          returnPeriod: "07/2026",
          returnType: "GSTR3B",
          totalTaxableValue: "1000000",
          totalCgst: "90000",
          totalSgst: "90000",
          totalIgst: "0",
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("GSTN integration is not available");
      expect(body.error.correlationId).toBeDefined();
    });

    it("GET /v1/billing/gstn/gstin/:gstin/verify returns 503 when disabled", async () => {
      vi.stubEnv("GSTN_ENABLED", "");
      vi.stubEnv("GSTN_BASE_URL", "");
      vi.stubEnv("GSTN_API_KEY", "");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/v1/billing/gstn/gstin/22AAAAA0000A1Z5/verify",
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
    it("POST /v1/billing/gstn/returns returns 201 with submitted return", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
      vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.submitGstReturn.submitted),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/gstn/returns",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          gstin: "22AAAAA0000A1Z5",
          returnPeriod: "07/2026",
          returnType: "GSTR3B",
          totalTaxableValue: "1000000",
          totalCgst: "90000",
          totalSgst: "90000",
          totalIgst: "0",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.referenceId).toBe("GSTN-RET-2026-07-001234");
      expect(body.data.status).toBe("submitted");
      expect(body.data.gstin).toBe("22AAAAA0000A1Z5");
      expect(body.data.submittedAt).toBe("2026-08-10T09:00:00.000Z");
    });

    it("GET /v1/billing/gstn/gstin/:gstin/verify returns active GSTIN", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
      vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.verifyGstin.active),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/v1/billing/gstn/gstin/22AAAAA0000A1Z5/verify",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.gstin).toBe("22AAAAA0000A1Z5");
      expect(body.data.status).toBe("active");
      expect(body.data.legalName).toBe("Government Department of Technology");
    });

    it("GET /v1/billing/gstn/returns/:ref/status returns filed status", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
      vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.fetchReturnStatus.filed),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/v1/billing/gstn/returns/GSTN-RET-2026-07-001234/status",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe("filed");
      expect(body.data.filedAt).toBe("2026-08-11T10:00:00.000Z");
    });

    it("handles cancelled GSTIN fixture", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
      vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.verifyGstin.cancelled),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/v1/billing/gstn/gstin/09BBBBB1111B2Y4/verify",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe("cancelled");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Circuit breaker opens after 5 failures → 503 CIRCUIT_OPEN
  // ═══════════════════════════════════════════════════════════════════

  describe("circuit breaker → 503 CIRCUIT_OPEN after 5 failures", () => {
    it("trips circuit breaker after 5 consecutive upstream failures", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
      vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("GSTN API unavailable"),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const token = makeToken();

      // Trigger 5 failures to trip the breaker
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/billing/gstn/gstin/22AAAAA0000A1Z5/verify",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(502);
      }

      // 6th call should hit the open circuit breaker
      const res = await app.inject({
        method: "GET",
        url: "/v1/billing/gstn/gstin/22AAAAA0000A1Z5/verify",
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
    it("POST /v1/billing/gstn/returns returns 401 without auth header", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/gstn/returns",
        payload: {
          gstin: "22AAAAA0000A1Z5",
          returnPeriod: "07/2026",
          returnType: "GSTR3B",
          totalTaxableValue: "1000000",
          totalCgst: "90000",
          totalSgst: "90000",
          totalIgst: "0",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("auth — 403 with wrong role", () => {
    it("POST /v1/billing/gstn/returns returns 403 for employee role", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/gstn/returns",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          gstin: "22AAAAA0000A1Z5",
          returnPeriod: "07/2026",
          returnType: "GSTR3B",
          totalTaxableValue: "1000000",
          totalCgst: "90000",
          totalSgst: "90000",
          totalIgst: "0",
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
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
      vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({
          error: "GSTIN 22AAAAA0000A1Z5 linked to PAN ABCDE1234F (Rajesh Kumar Pvt Ltd)",
        })),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      await app.ready();

      const res = await app.inject({
        method: "GET",
        url: "/v1/billing/gstn/gstin/22AAAAA0000A1Z5/verify",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      const responseText = JSON.stringify(res.json());
      // Must not contain any PII from the upstream response
      expect(responseText).not.toContain("Rajesh Kumar");
      expect(responseText).not.toContain("ABCDE1234F");
      expect(res.json().error.code).toBe("EXTERNAL_FAILURE");
    });
  });
});
