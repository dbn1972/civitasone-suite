import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/**
 * DOM-028 regression test.
 *
 * services/billing-service/src/modules/churn/routes.ts declared BILLING_ROLES
 * but never called requireRole with it, so all 3 routes below accepted any
 * authenticated caller regardless of role — confirmed pre-fix: a token
 * carrying only an unrelated role ("employee") got 200 from every route here.
 *
 * Covers, for each of the 3 routes:
 *   - 403 for a non-billing role (the bypass this gap describes)
 *   - 200 still succeeds for a billing role (billing_admin)
 *
 * Setup mirrors churn-routes.test.ts's "fallback mode" block (same module,
 * same required env stubs to boot the app).
 */

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const SUB_ID = "22222222-bbbb-4000-8000-000000000001";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dom028" }, SECRET, 3600);
}

const billingBearer = () => ({ authorization: `Bearer ${token(["billing_admin"])}`, "x-tenant-id": TENANT });
const unrelatedBearer = () => ({ authorization: `Bearer ${token(["employee"])}`, "x-tenant-id": TENANT });

describe("DOM-028: churn/revenue routes enforce BILLING_ROLES", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "false");
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const routes = [
    { label: "churn-risk", url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk` },
    { label: "revenue/forecast", url: "/v1/billing/revenue/forecast?horizon=3" },
    { label: "revenue/cohorts", url: "/v1/billing/revenue/cohorts" },
  ];

  for (const route of routes) {
    it(`GET ${route.label} returns 403 for a non-billing role`, async () => {
      const res = await app.inject({ method: "GET", url: route.url, headers: unrelatedBearer() });
      expect(res.statusCode).toBe(403);
    });

    it(`GET ${route.label} still returns 200 for billing_admin`, async () => {
      const res = await app.inject({ method: "GET", url: route.url, headers: billingBearer() });
      expect(res.statusCode).toBe(200);
    });
  }
});
