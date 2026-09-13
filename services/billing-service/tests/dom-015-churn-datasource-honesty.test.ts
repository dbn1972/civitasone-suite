/**
 * DOM-015 — churn-risk / revenue-forecast / revenue-cohorts must not present
 * entirely-canned numbers as if they were real.
 *
 * All three routes compute their answer from five "Data Access Stub"
 * functions (see churn/routes.ts's bottom section) that return the exact
 * same numbers for every subscription and every tenant — never a real query.
 * That was true even when a real ML call succeeded: the model just scored
 * manufactured features. Building real billing-data-backed features/MRR
 * history/churn-cohort math is a separate, larger effort (tracked in the gap
 * report), so — per DOM-015's DoD — every response is instead marked with an
 * explicit `dataSource: "stub"` so no caller can mistake this for real data.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000000d5";
const ACTOR = "00000000-aaaa-4000-8000-0000000000d5";
const SUB_ID = "22222222-bbbb-4000-8000-0000000000d5";

function authHeader(): Record<string, string> {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles: ["billing_admin"] }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT };
}

describe("Churn/revenue routes — dataSource honesty (DOM-015)", () => {
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

  it("marks churn-risk with dataSource: stub", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dataSource).toBe("stub");
  });

  it("marks revenue/forecast with dataSource: stub", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=3",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dataSource).toBe("stub");
  });

  it("marks revenue/cohorts with dataSource: stub", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/cohorts",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dataSource).toBe("stub");
  });
});
