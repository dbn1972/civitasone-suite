import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/**
 * Route-level integration tests for delay forecast route.
 *
 * Covers:
 * - GET /v1/projects/:projectId/delay-forecast → 200 (happy path, ML available)
 * - GET /v1/projects/:projectId/delay-forecast → 200 (fallback mode, ML disabled)
 * - GET /v1/projects/:projectId/delay-forecast → 200 (ML error → local computation)
 * - GET /v1/projects/:projectId/delay-forecast → 400 (invalid projectId)
 * - GET /v1/projects/:projectId/delay-forecast → 401 (no auth)
 * - Bottleneck detection (> 3 concurrent critical-path tasks per person)
 * - Risk score threshold (task risk > 0.80)
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const PROJECT_ID = "33333333-cccc-4000-8000-000000000001";

function token(roles: string[] = ["project_manager", "tenant_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-delay" }, SECRET, 3600);
}

describe("Delay forecast routes — fallback mode (ML disabled)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "false");

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

  it("GET /v1/projects/:projectId/delay-forecast returns 200 with forecast data", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/delay-forecast`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.p50Date).toBeDefined();
    expect(body.data.p80Date).toBeDefined();
    expect(body.data.p95Date).toBeDefined();
    expect(Array.isArray(body.data.taskRisks)).toBe(true);
    expect(Array.isArray(body.data.bottlenecks)).toBe(true);
    expect(typeof body.data.isFallback).toBe("boolean");
  });

  it("returns valid ISO date strings for p50/p80/p95", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/delay-forecast`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    const body = res.json();
    expect(() => new Date(body.data.p50Date)).not.toThrow();
    expect(() => new Date(body.data.p80Date)).not.toThrow();
    expect(() => new Date(body.data.p95Date)).not.toThrow();

    // Verify p50 ≤ p80 ≤ p95 ordering
    const p50 = new Date(body.data.p50Date).getTime();
    const p80 = new Date(body.data.p80Date).getTime();
    const p95 = new Date(body.data.p95Date).getTime();
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p95);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/delay-forecast`,
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/not-a-uuid/delay-forecast",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Delay forecast routes — ML available (mocked)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");

    // Mock fetch to simulate ml-service delay forecast response
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/v1/ml/predict")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            p50Ms: 604800000,   // 7 days
            p80Ms: 864000000,   // 10 days
            p95Ms: 1296000000,  // 15 days
            taskRisks: [
              { taskId: "task-6", riskScore: 0.85, factors: ["SPI below target", "high resource utilization"] },
              { taskId: "task-7", riskScore: 0.45, factors: ["moderate dependency chain"] },
            ],
            bottlenecks: [
              { userId: "user-1", concurrentCriticalTasks: 4 },
            ],
            fallback: false,
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

  it("returns ML prediction with task risks and bottlenecks", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/delay-forecast`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.isFallback).toBe(false);
    expect(body.data.taskRisks).toHaveLength(2);
    expect(body.data.taskRisks[0].riskScore).toBe(0.85);
    expect(body.data.taskRisks[0].taskId).toBe("task-6");
    expect(body.data.bottlenecks).toHaveLength(1);
    expect(body.data.bottlenecks[0].userId).toBe("user-1");
    expect(body.data.bottlenecks[0].concurrentCriticalTasks).toBe(4);
  });

  it("returns ISO date strings converted from ms offsets", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/delay-forecast`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    const body = res.json();
    const p50 = new Date(body.data.p50Date).getTime();
    const p80 = new Date(body.data.p80Date).getTime();
    const p95 = new Date(body.data.p95Date).getTime();

    // Verify ordering (p50 ≤ p80 ≤ p95)
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p95);
  });
});

describe("Delay forecast routes — ML error (fallback on failure)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");

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

  it("falls back to local computation when ML returns error", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/delay-forecast`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // When ML fails but enough tasks exist, it computes locally (not isFallback mode)
    expect(body.data.p50Date).toBeDefined();
    expect(body.data.p80Date).toBeDefined();
    expect(body.data.p95Date).toBeDefined();
    expect(Array.isArray(body.data.taskRisks)).toBe(true);
  });
});

describe("Delay forecast domain logic — risk score computation", () => {
  it("computeTaskRiskScores returns scores between 0 and 1", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u1", isCriticalPath: true, spiHistory: [0.5, 0.5], resourceUtilization: 0.9, isCompleted: false, baselineEndDate: "2025-12-01T00:00:00Z" },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: ["t1", "t3", "t4"], assignedTo: "u2", isCriticalPath: false, spiHistory: [1.0, 1.0], resourceUtilization: 0.3, isCompleted: false, baselineEndDate: "2025-12-05T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    for (const risk of risks) {
      expect(risk.riskScore).toBeGreaterThanOrEqual(0);
      expect(risk.riskScore).toBeLessThanOrEqual(1);
    }
  });

  it("high SPI deficit produces high risk score", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: ["d1", "d2", "d3", "d4", "d5"], assignedTo: "u1", isCriticalPath: true, spiHistory: [0.3, 0.2, 0.1], resourceUtilization: 0.95, isCompleted: false, baselineEndDate: "2025-12-01T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    expect(risks[0]!.riskScore).toBeGreaterThan(0.80);
    expect(risks[0]!.factors).toContain("SPI below target");
    expect(risks[0]!.factors).toContain("high resource utilization");
    expect(risks[0]!.factors).toContain("heavy dependency chain");
  });

  it("low risk features produce low risk score", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u1", isCriticalPath: false, spiHistory: [1.2, 1.1, 1.0], resourceUtilization: 0.2, isCompleted: false, baselineEndDate: "2025-12-01T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    expect(risks[0]!.riskScore).toBeLessThan(0.40);
  });

  it("skips completed tasks in risk scoring", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u1", isCriticalPath: true, spiHistory: [0.3], resourceUtilization: 0.9, isCompleted: true, baselineEndDate: "2025-12-01T00:00:00Z" },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u2", isCriticalPath: false, spiHistory: [1.0], resourceUtilization: 0.5, isCompleted: false, baselineEndDate: "2025-12-05T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.taskId).toBe("t2");
  });
});

describe("Delay forecast domain logic — bottleneck detection", () => {
  it("identifies bottleneck when user has > 3 concurrent critical-path tasks", async () => {
    const { identifyBottlenecks } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t4", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t5", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-normal", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
    ];

    const bottlenecks = identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0]!.userId).toBe("user-overloaded");
    expect(bottlenecks[0]!.concurrentCriticalTasks).toBe(4);
  });

  it("returns empty when no user exceeds threshold", async () => {
    const { identifyBottlenecks } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-b", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-c", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
    ];

    const bottlenecks = identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(0);
  });

  it("ignores completed tasks for bottleneck detection", async () => {
    const { identifyBottlenecks } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t4", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
    ];

    const bottlenecks = identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(0);
  });
});

describe("Delay forecast domain logic — fallback mode", () => {
  it("hasEnoughHistory returns false when < 5 completed tasks", async () => {
    const { hasEnoughHistory } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: false, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: false, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: false, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
    ];

    expect(hasEnoughHistory(tasks)).toBe(false);
  });

  it("hasEnoughHistory returns true when >= 5 completed tasks", async () => {
    const { hasEnoughHistory } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      taskId: `t${i + 1}`,
      baselineDurationMs: 86400000,
      varianceMs: 14400000,
      dependencies: [],
      isCriticalPath: false,
      spiHistory: [],
      resourceUtilization: 0.5,
      isCompleted: true,
    }));

    expect(hasEnoughHistory(tasks)).toBe(true);
  });

  it("computeFallbackForecast returns isFallback=true with baseline dates", async () => {
    const { computeFallbackForecast } = await import("../src/modules/delay-forecast/domain.js");

    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false, baselineEndDate: futureDate },
    ];

    const result = computeFallbackForecast(tasks);
    expect(result.isFallback).toBe(true);
    expect(result.p50Date).toBe(futureDate);
    expect(result.p80Date).toBe(futureDate);
    expect(result.p95Date).toBe(futureDate);
    expect(result.taskRisks).toHaveLength(0);
    expect(result.bottlenecks).toHaveLength(0);
  });
});

describe("Delay forecast domain logic — msToIsoDate", () => {
  it("converts milliseconds offset to ISO date string", async () => {
    const { msToIsoDate } = await import("../src/modules/delay-forecast/domain.js");

    const start = new Date("2025-01-01T00:00:00.000Z");
    const result = msToIsoDate(86400000, start); // 1 day
    expect(result).toBe("2025-01-02T00:00:00.000Z");
  });

  it("handles bigint input", async () => {
    const { msToIsoDate } = await import("../src/modules/delay-forecast/domain.js");

    const start = new Date("2025-01-01T00:00:00.000Z");
    const result = msToIsoDate(BigInt(172800000), start); // 2 days
    expect(result).toBe("2025-01-03T00:00:00.000Z");
  });

  it("uses current date as default start", async () => {
    const { msToIsoDate } = await import("../src/modules/delay-forecast/domain.js");

    const before = Date.now();
    const result = msToIsoDate(0);
    const after = Date.now();
    const resultTime = new Date(result).getTime();
    expect(resultTime).toBeGreaterThanOrEqual(before);
    expect(resultTime).toBeLessThanOrEqual(after);
  });
});
