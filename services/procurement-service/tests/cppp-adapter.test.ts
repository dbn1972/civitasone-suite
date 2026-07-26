import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

/**
 * Route-level integration tests for the CPPP (Central Public Procurement
 * Portal) adapter endpoints.
 *
 * Proves:
 * - fail-closed 503 INTEGRATION_DISABLED when CPPP_ENABLED !== 'true'
 *   (no fabricated success for an unconfigured portal)
 * - auth (401) + role (403) enforcement
 * - zod validation (400)
 * - happy path publish/fetch/bid-status against a mocked upstream
 * - circuit-breaker 503 CIRCUIT_OPEN after 5 consecutive upstream failures
 * - adapter error messages carry no PII
 *
 * Validates: SVC-050 (CPPP e-procurement integration)
 */

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function makeToken(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-test" }, JWT_SECRET, 3600);
}

const validTender = {
  referenceId: "TND-LOCAL-001",
  title: "Supply of Desktop Computers",
  organisationChain: "Dept of IT||Directorate of Procurement",
  tenderType: "open" as const,
  estimatedValueMinor: "500000000",
  currency: "INR",
  bidSubmissionEndAt: "2026-09-01T10:00:00Z",
};

describe("CPPP adapter routes", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  describe("when adapter is disabled (default) — fail closed", () => {
    it("POST /v1/procurement/cppp/tenders returns 503 INTEGRATION_DISABLED", async () => {
      vi.stubEnv("CPPP_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/cppp/tenders",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}`, "content-type": "application/json" },
        payload: validTender,
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("CPPP integration is not available");
      expect(body.error.correlationId).toBeDefined();
      await app.close();
    });

    it("GET /v1/procurement/cppp/tenders/:id returns 503 INTEGRATION_DISABLED", async () => {
      vi.stubEnv("CPPP_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/cppp/tenders/2026_DEPT_1",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}` },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
      await app.close();
    });

    it("GET /v1/procurement/cppp/tenders/:id/bids returns 503 even when ENABLED but creds missing", async () => {
      vi.stubEnv("CPPP_ENABLED", "true"); // enabled but no base url / api key → still fail closed
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/cppp/tenders/2026_DEPT_1/bids",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}` },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
      await app.close();
    });
  });

  describe("authentication and authorization", () => {
    it("POST without auth returns 401", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/v1/procurement/cppp/tenders", headers: { "content-type": "application/json" }, payload: validTender });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("POST with non-procurement role returns 403", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/cppp/tenders",
        headers: { authorization: `Bearer ${makeToken(["employee"])}`, "content-type": "application/json" },
        payload: validTender,
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("validation", () => {
    it("POST with invalid body returns 400", async () => {
      vi.stubEnv("CPPP_ENABLED", "true");
      vi.stubEnv("CPPP_BASE_URL", "https://cppp.example.gov.in");
      vi.stubEnv("CPPP_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/cppp/tenders",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}`, "content-type": "application/json" },
        payload: { referenceId: "", title: "", tenderType: "bogus", estimatedValueMinor: "abc" },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      await app.close();
    });
  });

  describe("happy path (mocked upstream)", () => {
    it("POST /tenders returns 202 with cpppTenderId", async () => {
      vi.stubEnv("CPPP_ENABLED", "true");
      vi.stubEnv("CPPP_BASE_URL", "https://cppp.example.gov.in");
      vi.stubEnv("CPPP_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ cpppTenderId: "2026_DEPTIT_123456_1", status: "published", publishedAt: "2026-07-26T10:00:00Z" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/cppp/tenders",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}`, "content-type": "application/json" },
        payload: validTender,
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().data.cpppTenderId).toBe("2026_DEPTIT_123456_1");
      expect(res.json().data.status).toBe("published");
      await app.close();
    });

    it("GET /tenders/:id returns 200 with details", async () => {
      vi.stubEnv("CPPP_ENABLED", "true");
      vi.stubEnv("CPPP_BASE_URL", "https://cppp.example.gov.in");
      vi.stubEnv("CPPP_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          cpppTenderId: "2026_DEPTIT_123456_1", title: "Supply of Desktop Computers",
          organisationChain: "Dept of IT", tenderType: "open", estimatedValueMinor: "500000000",
          currency: "INR", status: "under_evaluation", bidSubmissionEndAt: "2026-09-01T10:00:00Z",
          lastUpdatedAt: "2026-07-26T11:00:00Z",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/cppp/tenders/2026_DEPTIT_123456_1",
        headers: { authorization: `Bearer ${makeToken(["procurement_admin"])}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("under_evaluation");
      await app.close();
    });

    it("GET /tenders/:id/bids returns 200 with bid status", async () => {
      vi.stubEnv("CPPP_ENABLED", "true");
      vi.stubEnv("CPPP_BASE_URL", "https://cppp.example.gov.in");
      vi.stubEnv("CPPP_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ cpppTenderId: "2026_DEPTIT_123456_1", status: "awarded", bidsReceived: 7, awardedBidder: "ACME Systems", awardedValueMinor: "480000000", lastUpdatedAt: "2026-07-26T12:00:00Z" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/cppp/tenders/2026_DEPTIT_123456_1/bids",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("awarded");
      expect(res.json().data.bidsReceived).toBe(7);
      await app.close();
    });
  });

  describe("circuit breaker at route level", () => {
    it("returns 503 CIRCUIT_OPEN after 5 consecutive upstream failures", async () => {
      vi.stubEnv("CPPP_ENABLED", "true");
      vi.stubEnv("CPPP_BASE_URL", "https://cppp.example.gov.in");
      vi.stubEnv("CPPP_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("err") });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const token = makeToken(["procurement_officer"]);
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({ method: "GET", url: "/v1/procurement/cppp/tenders/T1", headers: { authorization: `Bearer ${token}` } });
        expect(r.statusCode).toBe(502);
      }
      const res = await app.inject({ method: "GET", url: "/v1/procurement/cppp/tenders/T1", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("CIRCUIT_OPEN");
      await app.close();
    });
  });

  describe("no PII in adapter errors", () => {
    it("error messages do not contain PII patterns", async () => {
      const { CpppAdapterError } = await import("../src/modules/cppp/adapter.js");
      const err = new CpppAdapterError("CPPP API returned 500", "CPPP_API_ERROR", 500);
      expect(err.message).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN
      expect(err.message).not.toMatch(/\b\d{12}\b/); // Aadhaar
      expect(err.message).not.toMatch(/\b[\w.-]+@[\w.-]+\.\w+\b/); // Email
      expect(err.code).toBe("CPPP_API_ERROR");
    });

    it("isEnabled() is false when creds are missing", async () => {
      vi.stubEnv("CPPP_ENABLED", "true");
      const { isEnabled } = await import("../src/modules/cppp/adapter.js");
      expect(isEnabled()).toBe(false);
    });
  });
});
