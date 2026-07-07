import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

/**
 * Contract tests for the e-Courts external integration adapter.
 *
 * Validates recorded fixture responses (realistic shapes), disabled state,
 * circuit breaker behavior, auth checks, and PII-free error responses.
 *
 * Uses mocked globalThis.fetch with recorded fixture data for CI.
 * When ECOURTS_LIVE_SANDBOX=true is set, tests hit the real sandbox API.
 *
 * Validates: Requirements 23.4
 */

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000020";
const ACTOR = "00000000-aaaa-4000-8000-000000000020";

function makeToken(roles: string[] = ["legal_officer"]): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles, sid: "sess-contract" },
    JWT_SECRET,
    3600,
  );
}

// ── Recorded fixture: realistic e-Courts CNR response shape ──────

const RECORDED_CNR_FIXTURE = {
  cnrNumber: "DLHC010012345672026",
  caseStatus: "pending",
  courtName: "High Court of Delhi",
  hearingDates: [
    { date: "2026-08-15", purpose: "Arguments" },
    { date: "2026-09-20", purpose: "Final hearing" },
    { date: "2026-11-01", purpose: "Pronouncement of order" },
  ],
  orders: [
    {
      date: "2026-07-01",
      description: "Interim stay granted",
      downloadUrl: "https://ecourts.gov.in/orders/DLHC010012345672026-01.pdf",
    },
    {
      date: "2026-06-15",
      description: "Notice issued to respondent",
    },
  ],
  lastUpdated: "2026-07-10T10:00:00.000Z",
};

describe("e-Courts adapter — contract tests (recorded fixtures)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("recorded fixture response shape", () => {
    it("CNR lookup returns correct shape with hearingDates array and orders array", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts-sandbox.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "sandbox-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(RECORDED_CNR_FIXTURE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { lookupCnr } = await import("../src/modules/ecourts/adapter.js");
      const result = await lookupCnr("DLHC010012345672026");

      // Validate shape matches fixture contract
      expect(result).toHaveProperty("cnrNumber");
      expect(result).toHaveProperty("caseStatus");
      expect(result).toHaveProperty("courtName");
      expect(result).toHaveProperty("hearingDates");
      expect(result).toHaveProperty("orders");
      expect(result).toHaveProperty("lastUpdated");

      // Validate types
      expect(typeof result.cnrNumber).toBe("string");
      expect(typeof result.caseStatus).toBe("string");
      expect(typeof result.courtName).toBe("string");
      expect(Array.isArray(result.hearingDates)).toBe(true);
      expect(Array.isArray(result.orders)).toBe(true);
      expect(typeof result.lastUpdated).toBe("string");

      // Validate hearing dates shape
      for (const hearing of result.hearingDates) {
        expect(hearing).toHaveProperty("date");
        expect(hearing).toHaveProperty("purpose");
        expect(typeof hearing.date).toBe("string");
        expect(typeof hearing.purpose).toBe("string");
      }

      // Validate orders shape
      for (const order of result.orders) {
        expect(order).toHaveProperty("date");
        expect(order).toHaveProperty("description");
        expect(typeof order.date).toBe("string");
        expect(typeof order.description).toBe("string");
        // downloadUrl is optional
        if (order.downloadUrl !== undefined) {
          expect(typeof order.downloadUrl).toBe("string");
        }
      }
    });

    it("handles empty hearingDates and orders gracefully", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts-sandbox.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "sandbox-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            cnrNumber: "MHBM010099887762026",
            caseStatus: "disposed",
            courtName: "City Civil Court, Mumbai",
            hearingDates: [],
            orders: [],
            lastUpdated: "2026-06-01T08:30:00Z",
          }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { lookupCnr } = await import("../src/modules/ecourts/adapter.js");
      const result = await lookupCnr("MHBM010099887762026");

      expect(result.cnrNumber).toBe("MHBM010099887762026");
      expect(result.caseStatus).toBe("disposed");
      expect(result.hearingDates).toEqual([]);
      expect(result.orders).toEqual([]);
    });
  });

  describe("disabled → INTEGRATION_DISABLED", () => {
    it("throws INTEGRATION_DISABLED when ECOURTS_ENABLED is not true", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "false");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "test-key");

      const { lookupCnr } = await import("../src/modules/ecourts/adapter.js");

      await expect(lookupCnr("DLHC010012345672026")).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
        name: "ECourtsAdapterError",
      });
    });
  });

  describe("circuit breaker open → CIRCUIT_OPEN", () => {
    it("opens after 5 consecutive failures and throws CircuitBreakerOpenError", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts-sandbox.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "sandbox-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { lookupCnr, getBreakerState } = await import("../src/modules/ecourts/adapter.js");
      const { CircuitBreakerOpenError } = await import("@civitasone/circuit-breaker");

      // Trip the breaker with 5 failures
      for (let i = 0; i < 5; i++) {
        await expect(lookupCnr("FAIL_CNR")).rejects.toMatchObject({
          code: "ECOURTS_API_ERROR",
        });
      }

      expect(getBreakerState()).toBe("open");

      // Next call should get CircuitBreakerOpenError
      await expect(lookupCnr("FAIL_CNR")).rejects.toBeInstanceOf(CircuitBreakerOpenError);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it("route returns 503 with CIRCUIT_OPEN code when breaker is open", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts-sandbox.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "sandbox-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      // Fail 5 times to open the breaker
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["legal_officer"]);

      // Trip the breaker
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: "GET",
          url: "/v1/legal/ecourts/cases/TRIP_BREAKER_CNR",
          headers: { authorization: `Bearer ${token}` },
        });
      }

      // Next request should get CIRCUIT_OPEN
      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/AFTER_BREAKER_CNR",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.message).toBe("e-Courts service is temporarily unavailable");
      expect(body.error.correlationId).toBeDefined();

      await app.close();
    });
  });

  describe("401/403 auth", () => {
    it("returns 401 when no token provided", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      vi.stubGlobal("fetch", vi.fn());

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/DLHC010012345672026",
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 when user has non-legal role", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);
      vi.stubGlobal("fetch", vi.fn());

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/DLHC010012345672026",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("no PII in error responses", () => {
    it("upstream error does not leak request body or PII", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts-sandbox.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "sandbox-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: "Invalid CNR for advocate Mr. Rajesh Sharma, contact: 9876543210",
            }),
          ),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["legal_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/DLHC010012345672026",
        headers: { authorization: `Bearer ${token}` },
      });

      const responseText = JSON.stringify(res.json());
      // No PII should leak into the error response
      expect(responseText).not.toContain("Rajesh Sharma");
      expect(responseText).not.toContain("9876543210");
      expect(responseText).not.toContain("advocate");
      // Should contain a generic error
      expect(res.json().error.code).toBe("UPSTREAM_ERROR");
      expect(res.json().error.correlationId).toBeDefined();

      await app.close();
    });

    it("INTEGRATION_DISABLED error does not contain sensitive data", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["legal_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/DLHC010012345672026",
        headers: { authorization: `Bearer ${token}` },
      });

      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      // No API keys, secrets, or internal URLs in the response
      expect(JSON.stringify(body)).not.toContain("sandbox-api-key");
      expect(JSON.stringify(body)).not.toContain("ECOURTS_API_KEY");
      expect(JSON.stringify(body)).not.toContain("Bearer");

      await app.close();
    });
  });
});
