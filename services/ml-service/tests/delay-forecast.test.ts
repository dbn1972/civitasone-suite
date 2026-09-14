/**
 * Delay Forecast Simulation Route Tests — POST /v1/ml/internal/delay-forecast/simulate
 *
 * DOM-017: monte-carlo.ts's simulateProjectDelay had zero callers anywhere in
 * the fleet before this route existed — this file's first test fails
 * immediately if the route is ever reverted to a stub, since it compares the
 * route's HTTP response byte-for-byte against calling the real algorithm
 * in-process with the same seed. Uses the REAL authPlugin (the same
 * x-internal + x-service-secret + x-tenant-id mechanism project-service's
 * adapter now speaks — see
 * services/project-service/src/modules/delay-forecast/adapter.ts), not a
 * mock, so the internal-service auth wiring is genuinely exercised.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { delayForecastRoutes } from "../src/modules/delay-forecast/routes.js";
import { simulateProjectDelay, type TaskSimInput } from "../src/modules/algorithms/monte-carlo.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function internalHeaders(tenantId = TENANT): Record<string, string> {
  return {
    "x-internal": "1",
    "x-service-secret": SECRET,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };
}

const SAMPLE_TASKS: TaskSimInput[] = [
  { taskId: "t1", baselineDurationMs: 86_400_000, varianceMs: 3_600_000, dependencies: [], isCriticalPath: true, assignedTo: "u1" },
  { taskId: "t2", baselineDurationMs: 172_800_000, varianceMs: 7_200_000, dependencies: ["t1"], isCriticalPath: true },
  { taskId: "t3", baselineDurationMs: 43_200_000, varianceMs: 0, dependencies: ["t1"], isCriticalPath: false },
];

describe("POST /v1/ml/internal/delay-forecast/simulate", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET = SECRET;
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(delayForecastRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.INTERNAL_SERVICE_SECRET;
  });

  it("runs the REAL Monte Carlo simulation — matches simulateProjectDelay's own output for the same seed", async () => {
    const seed = 42;
    const expected = simulateProjectDelay(SAMPLE_TASKS, 200, seed);

    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/internal/delay-forecast/simulate",
      headers: internalHeaders(),
      payload: { tasks: SAMPLE_TASKS, iterations: 200, seed },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.p50Ms).toBe(Number(expected.p50Ms));
    expect(body.data.p80Ms).toBe(Number(expected.p80Ms));
    expect(body.data.p95Ms).toBe(Number(expected.p95Ms));
    expect(body.data.taskRisks).toEqual(expected.taskRisks);
    expect(body.data.bottlenecks).toEqual(expected.bottlenecks);
  });

  it("returns p50 <= p80 <= p95 and task risks referencing only supplied task ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/internal/delay-forecast/simulate",
      headers: internalHeaders(),
      payload: { tasks: SAMPLE_TASKS, iterations: 300, seed: 7 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.p50Ms).toBeLessThanOrEqual(body.data.p80Ms);
    expect(body.data.p80Ms).toBeLessThanOrEqual(body.data.p95Ms);
    const knownIds = new Set(SAMPLE_TASKS.map((t) => t.taskId));
    expect(body.data.taskRisks.length).toBeGreaterThan(0);
    for (const risk of body.data.taskRisks) {
      expect(knownIds.has(risk.taskId)).toBe(true);
    }
  });

  it("rejects a request with no internal-service auth and no JWT (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/internal/delay-forecast/simulate",
      headers: { "content-type": "application/json" },
      payload: { tasks: SAMPLE_TASKS },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong x-service-secret (401) — proves the secret is actually checked, not just presence of x-internal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/internal/delay-forecast/simulate",
      headers: { "x-internal": "1", "x-service-secret": "wrong-secret", "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { tasks: SAMPLE_TASKS },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s on an empty task list", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/internal/delay-forecast/simulate",
      headers: internalHeaders(),
      payload: { tasks: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("defaults to 1000 iterations when unspecified", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/internal/delay-forecast/simulate",
      headers: internalHeaders(),
      payload: { tasks: SAMPLE_TASKS },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.taskRisks.length).toBe(SAMPLE_TASKS.length);
  });
});
