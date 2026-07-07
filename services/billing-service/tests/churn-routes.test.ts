import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/**
 * Route-level integration tests for churn risk and revenue forecast routes.
 *
 * Covers:
 * - GET /v1/billing/subscriptions/:id/churn-risk → 200 (happy path, ML available)
 * - GET /v1/billing/subscriptions/:id/churn-risk → 200 (fallback mode)
 * - GET /v1/billing/revenue/forecast?horizon=3 → 200 (happy path)
 * - GET /v1/billing/revenue/forecast → 400 (missing horizon)
 * - GET /v1/billing/revenue/forecast?horizon=7 → 400 (invalid horizon)
 * - 401 without auth
 * - Churn threshold classification (high > 0.70, medium 0.40–0.70, low < 0.40)
 * - Revenue horizon validation (3, 6, 12 only)
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const SUB_ID = "22222222-bbbb-4000-8000-000000000001";

function token(roles: string[] = ["billing_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-churn" }, SECRET, 3600);
}

describe("Churn risk routes — fallback mode (ML disabled)", () => {
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

  it("GET /v1/billing/subscriptions/:id/churn-risk returns 200 with fallback result", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.probability).toBeGreaterThanOrEqual(0);
    expect(body.data.probability).toBeLessThanOrEqual(1);
    expect(body.data.riskLevel).toMatch(/^(high|medium|low)$/);
    expect(Array.isArray(body.data.factors)).toBe(true);
    expect(body.data.isFallback).toBe(true);
  });

  it("GET /v1/billing/subscriptions/:id/churn-risk returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk`,
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/billing/subscriptions/:id/churn-risk returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/subscriptions/not-a-uuid/churn-risk",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Churn risk routes — ML available (mocked)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");

    // Mock fetch to simulate ml-service predict response
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/v1/ml/predict")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            prediction: 0.82,
            confidence: 0.75,
            factors: [
              { feature: "paymentDelayAvgDays", contribution: 0.4, direction: "positive" },
              { feature: "daysSinceLastLogin", contribution: 0.3, direction: "positive" },
              { feature: "usageScore", contribution: 0.2, direction: "negative" },
            ],
            fallback: false,
            modelVersion: 3,
            advisory: true,
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("not found") });
    });
    vi.stubGlobal("fetch", fetchMock);

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

  it("GET /v1/billing/subscriptions/:id/churn-risk returns ML prediction with high risk", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.probability).toBe(0.82);
    expect(body.data.riskLevel).toBe("high");
    expect(body.data.factors).toHaveLength(3);
    expect(body.data.isFallback).toBe(false);
  });
});

describe("Churn risk routes — ML error (fallback on failure)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");

    // Mock fetch to simulate ml-service failure
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/v1/ml/predict")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("internal server error"),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("not found") });
    });
    vi.stubGlobal("fetch", fetchMock);

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

  it("falls back to rule-based scoring when ML returns error", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/billing/subscriptions/${SUB_ID}/churn-risk`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.isFallback).toBe(true);
    expect(body.data.probability).toBeGreaterThanOrEqual(0);
    expect(body.data.probability).toBeLessThanOrEqual(1);
    expect(body.data.riskLevel).toMatch(/^(high|medium|low)$/);
  });
});

describe("Revenue forecast routes", () => {
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

  it("GET /v1/billing/revenue/forecast?horizon=3 returns 200 with projections", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=3",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.currentMrr).toBeGreaterThan(0);
    expect(body.data.projectedMrr).toBeGreaterThanOrEqual(0);
    expect(body.data.churnImpact).toBeGreaterThanOrEqual(0);
    expect(body.data.expansionImpact).toBeGreaterThanOrEqual(0);
    expect(body.data.cashFlowProjection).toHaveLength(3);
  });

  it("GET /v1/billing/revenue/forecast?horizon=6 returns 6-month projection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=6",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.cashFlowProjection).toHaveLength(6);
  });

  it("GET /v1/billing/revenue/forecast?horizon=12 returns 12-month projection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=12",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.cashFlowProjection).toHaveLength(12);
  });

  it("GET /v1/billing/revenue/forecast returns 400 without horizon param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/billing/revenue/forecast?horizon=7 returns 400 for invalid horizon", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=7",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/billing/revenue/forecast returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=3",
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("cash flow projection includes churnLoss, expansionGain, and netMrr per month", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/forecast?horizon=3",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const entry of body.data.cashFlowProjection) {
      expect(entry).toHaveProperty("month");
      expect(entry).toHaveProperty("projectedMrr");
      expect(entry).toHaveProperty("churnLoss");
      expect(entry).toHaveProperty("expansionGain");
      expect(entry).toHaveProperty("netMrr");
      expect(entry.churnLoss).toBeGreaterThanOrEqual(0);
      expect(entry.expansionGain).toBeGreaterThanOrEqual(0);
      expect(entry.netMrr).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Churn domain logic — threshold classification", () => {
  it("classifies probability > 0.70 as high", async () => {
    const { classifyRiskLevel } = await import("../src/modules/churn/domain.js");
    expect(classifyRiskLevel(0.71)).toBe("high");
    expect(classifyRiskLevel(0.85)).toBe("high");
    expect(classifyRiskLevel(1.0)).toBe("high");
  });

  it("classifies probability 0.40–0.70 as medium", async () => {
    const { classifyRiskLevel } = await import("../src/modules/churn/domain.js");
    expect(classifyRiskLevel(0.40)).toBe("medium");
    expect(classifyRiskLevel(0.55)).toBe("medium");
    expect(classifyRiskLevel(0.70)).toBe("medium");
  });

  it("classifies probability < 0.40 as low", async () => {
    const { classifyRiskLevel } = await import("../src/modules/churn/domain.js");
    expect(classifyRiskLevel(0.0)).toBe("low");
    expect(classifyRiskLevel(0.20)).toBe("low");
    expect(classifyRiskLevel(0.39)).toBe("low");
  });

  it("fallback score returns value between 0 and 1", async () => {
    const { fallbackChurnScore } = await import("../src/modules/churn/domain.js");
    const result = fallbackChurnScore({
      paymentDelayAvgDays: 15,
      supportTicketCount90d: 5,
      daysSinceLastLogin: 30,
      usageScore: 40,
      tenureDays: 60,
    });
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
    expect(result.riskLevel).toMatch(/^(high|medium|low)$/);
    expect(result.factors.length).toBeLessThanOrEqual(3);
  });

  it("high-risk features produce high probability", async () => {
    const { fallbackChurnScore } = await import("../src/modules/churn/domain.js");
    const result = fallbackChurnScore({
      paymentDelayAvgDays: 45,
      supportTicketCount90d: 12,
      daysSinceLastLogin: 90,
      usageScore: 10,
      tenureDays: 30,
    });
    expect(result.riskLevel).toBe("high");
    expect(result.probability).toBeGreaterThan(0.70);
  });

  it("low-risk features produce low probability", async () => {
    const { fallbackChurnScore } = await import("../src/modules/churn/domain.js");
    const result = fallbackChurnScore({
      paymentDelayAvgDays: 0,
      supportTicketCount90d: 0,
      daysSinceLastLogin: 1,
      usageScore: 95,
      tenureDays: 365,
    });
    expect(result.riskLevel).toBe("low");
    expect(result.probability).toBeLessThan(0.40);
  });
});

describe("Revenue forecast domain logic", () => {
  it("returns empty result for empty MRR history", async () => {
    const { computeRevenueForecast } = await import("../src/modules/churn/domain.js");
    const result = computeRevenueForecast([], 3, 0.03, 0.05);
    expect(result.currentMrr).toBe(0);
    expect(result.projectedMrr).toBe(0);
    expect(result.cashFlowProjection).toHaveLength(0);
  });

  it("produces correct number of projection months", async () => {
    const { computeRevenueForecast } = await import("../src/modules/churn/domain.js");
    const history = [
      { month: "2025-01-01", mrr: 100000 },
      { month: "2025-02-01", mrr: 105000 },
      { month: "2025-03-01", mrr: 110000 },
    ];
    const result = computeRevenueForecast(history, 6, 0.03, 0.05);
    expect(result.cashFlowProjection).toHaveLength(6);
    expect(result.currentMrr).toBe(110000);
  });

  it("computes cohort retention curves correctly", async () => {
    const { computeCohortAnalysis } = await import("../src/modules/churn/domain.js");
    const subs = [
      { startMonth: "2025-01", subscriptionId: "a", isActive: true, monthsActive: 6 },
      { startMonth: "2025-01", subscriptionId: "b", isActive: true, monthsActive: 4 },
      { startMonth: "2025-01", subscriptionId: "c", isActive: false, monthsActive: 2 },
      { startMonth: "2025-02", subscriptionId: "d", isActive: true, monthsActive: 3 },
    ];
    const cohorts = computeCohortAnalysis(subs);
    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]!.cohortMonth).toBe("2025-01");
    expect(cohorts[0]!.startCount).toBe(3);
    expect(cohorts[0]!.retentionCurve[0]).toBe(100); // all 3 have >= 1 month
    expect(cohorts[0]!.retentionCurve[1]).toBe(100); // all 3 have >= 2 months
    expect(cohorts[0]!.retentionCurve[2]).toBe(67);  // 2/3 have >= 3 months
  });
});
