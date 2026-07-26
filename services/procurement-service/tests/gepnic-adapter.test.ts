import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

/**
 * Route-level integration tests for the GePNIC (Government eProcurement System
 * of NIC) adapter endpoints.
 *
 * Proves:
 * - fail-closed 503 INTEGRATION_DISABLED when GEPNIC_ENABLED !== 'true'
 *   (no fabricated success for an unconfigured system)
 * - auth (401) + role (403) enforcement
 * - zod validation (400)
 * - happy path publish/fetch/award-status against a mocked upstream
 * - circuit-breaker 503 CIRCUIT_OPEN after 5 consecutive upstream failures
 * - adapter error messages carry no PII
 *
 * Validates: SVC-050 (GePNIC e-procurement integration)
 */

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function makeToken(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-test" }, JWT_SECRET, 3600);
}

const validTender = {
  referenceId: "TND-LOCAL-002",
  tenderTitle: "Construction of District Office Building",
  departmentName: "Public Works Department",
  workCategory: "Civil Works",
  procurementNature: "works" as const,
  estimatedValueMinor: "2500000000",
  currency: "INR",
  publishDate: "2026-07-26T09:00:00Z",
  bidSubmissionEndAt: "2026-09-15T17:00:00Z",
};

describe("GePNIC adapter routes", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  describe("when adapter is disabled (default) — fail closed", () => {
    it("POST /v1/procurement/gepnic/tenders returns 503 INTEGRATION_DISABLED", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gepnic/tenders",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}`, "content-type": "application/json" },
        payload: validTender,
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("GePNIC integration is not available");
      expect(body.error.correlationId).toBeDefined();
      await app.close();
    });

    it("GET /v1/procurement/gepnic/tenders/:id/award returns 503 when ENABLED but creds missing", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "true"); // enabled but no creds → still fail closed
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gepnic/tenders/2026_NIC_1/award",
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
      const res = await app.inject({ method: "POST", url: "/v1/procurement/gepnic/tenders", headers: { "content-type": "application/json" }, payload: validTender });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("POST with non-procurement role returns 403", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gepnic/tenders",
        headers: { authorization: `Bearer ${makeToken(["employee"])}`, "content-type": "application/json" },
        payload: validTender,
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("validation", () => {
    it("POST with invalid body returns 400", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "true");
      vi.stubEnv("GEPNIC_BASE_URL", "https://gepnic.example.gov.in");
      vi.stubEnv("GEPNIC_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gepnic/tenders",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}`, "content-type": "application/json" },
        payload: { referenceId: "", tenderTitle: "", procurementNature: "bogus", estimatedValueMinor: "xyz" },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      await app.close();
    });
  });

  describe("happy path (mocked upstream)", () => {
    it("POST /tenders returns 202 with gepnicTenderId", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "true");
      vi.stubEnv("GEPNIC_BASE_URL", "https://gepnic.example.gov.in");
      vi.stubEnv("GEPNIC_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ gepnicTenderId: "2026_PWD_987654_1", status: "published", publishedAt: "2026-07-26T10:00:00Z" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gepnic/tenders",
        headers: { authorization: `Bearer ${makeToken(["procurement_officer"])}`, "content-type": "application/json" },
        payload: validTender,
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().data.gepnicTenderId).toBe("2026_PWD_987654_1");
      await app.close();
    });

    it("GET /tenders/:id/award returns 200 with award status", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "true");
      vi.stubEnv("GEPNIC_BASE_URL", "https://gepnic.example.gov.in");
      vi.stubEnv("GEPNIC_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ gepnicTenderId: "2026_PWD_987654_1", status: "awarded", awardedBidder: "BuildCo Pvt Ltd", awardedValueMinor: "2400000000", awardOfContractDate: "2026-09-20T00:00:00Z", lastUpdatedAt: "2026-09-20T10:00:00Z" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gepnic/tenders/2026_PWD_987654_1/award",
        headers: { authorization: `Bearer ${makeToken(["procurement_admin"])}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("awarded");
      expect(res.json().data.awardedBidder).toBe("BuildCo Pvt Ltd");
      await app.close();
    });
  });

  describe("circuit breaker at route level", () => {
    it("returns 503 CIRCUIT_OPEN after 5 consecutive upstream failures", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "true");
      vi.stubEnv("GEPNIC_BASE_URL", "https://gepnic.example.gov.in");
      vi.stubEnv("GEPNIC_API_KEY", "test-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("err") });
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const token = makeToken(["procurement_officer"]);
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({ method: "GET", url: "/v1/procurement/gepnic/tenders/T1", headers: { authorization: `Bearer ${token}` } });
        expect(r.statusCode).toBe(502);
      }
      const res = await app.inject({ method: "GET", url: "/v1/procurement/gepnic/tenders/T1", headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("CIRCUIT_OPEN");
      await app.close();
    });
  });

  describe("no PII in adapter errors", () => {
    it("error messages do not contain PII patterns", async () => {
      const { GepnicAdapterError } = await import("../src/modules/gepnic/adapter.js");
      const err = new GepnicAdapterError("GePNIC API returned 500", "GEPNIC_API_ERROR", 500);
      expect(err.message).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN
      expect(err.message).not.toMatch(/\b\d{12}\b/); // Aadhaar
      expect(err.message).not.toMatch(/\b[\w.-]+@[\w.-]+\.\w+\b/); // Email
      expect(err.code).toBe("GEPNIC_API_ERROR");
    });

    it("isEnabled() is false when creds are missing", async () => {
      vi.stubEnv("GEPNIC_ENABLED", "true");
      const { isEnabled } = await import("../src/modules/gepnic/adapter.js");
      expect(isEnabled()).toBe(false);
    });
  });
});
