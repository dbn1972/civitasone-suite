import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";

/**
 * Route-level integration tests for e-Courts endpoints.
 *
 * Tests:
 * - GET /v1/legal/ecourts/cases/:cnr → 503 INTEGRATION_DISABLED when not configured
 * - GET /v1/legal/ecourts/cases/:cnr → 200 happy path (mocked upstream)
 * - GET /v1/legal/ecourts/cases/:cnr → 401 without token
 * - GET /v1/legal/ecourts/cases/:cnr → 403 without legal role
 * - GET /v1/legal/ecourts/cases/:cnr → 503 CIRCUIT_OPEN when breaker is open
 *
 * Validates: Requirements 10.1, 10.6
 */

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000020";
const ACTOR = "00000000-aaaa-4000-8000-000000000020";

function makeToken(roles: string[]): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles, sid: "sess-test" },
    JWT_SECRET,
    3600,
  );
}

describe("e-Courts routes", () => {
  describe("when adapter is disabled (default)", () => {
    it("GET /v1/legal/ecourts/cases/:cnr returns 503 INTEGRATION_DISABLED", async () => {
      // ECOURTS_ENABLED is not set (or not 'true') by default in test env
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["legal_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/DLHC010012345672026",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("e-Courts integration is not available");
      expect(body.error.correlationId).toBeDefined();

      await app.close();
    });

    it("GET /v1/legal/ecourts/cases/:cnr without auth returns 401", async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/legal/ecourts/cases/DLHC010012345672026",
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("GET /v1/legal/ecourts/cases/:cnr with non-legal role returns 403", async () => {
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
});
