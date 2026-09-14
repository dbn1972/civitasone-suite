/**
 * Delay forecast consumer tests — project.task.updated -> risk re-evaluation.
 *
 * DOM-017: this consumer used to call predictDelay() with a bogus
 * `{ taskId, trigger: "task_updated" }` payload force-cast to the adapter's
 * features record — never real task data — and its ml-failure branch just
 * logged and returned, skipping risk re-evaluation entirely (even though
 * computeTaskRiskScores/getHighRiskTasks were already imported for exactly
 * that fallback and never wired up). These tests prove:
 *   1. the consumer now loads and sends the project's REAL tasks to
 *      ml-service's real Monte Carlo endpoint, and
 *   2. it genuinely falls back to computeTaskRiskScores over those real
 *      tasks — not a silent no-op — when ml-service is unreachable.
 *
 * Uses a stub Queue (captures the subscribed handler) and mocks only the
 * network boundary (global.fetch) plus the outbox/db housekeeping calls —
 * getProjectTasks is mocked to a fixed real-shaped task list so this test
 * doesn't need a live Postgres (the route-level tests in delay-forecast.test.ts
 * already cover getProjectTasks itself against a real DB).
 *
 * Validates: Requirements 10.5, 10.6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Queue } from "@civitasone/queue";

const TENANT = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const TASK_ID = "22222222-2222-2222-2222-222222222222";

// A single task engineered to score > 0.80 in computeTaskRiskScores (domain.ts):
// spiRisk (1 - 0.1 = 0.9) * 0.40 = 0.36, utilizationRisk (0.95) * 0.30 = 0.285,
// depRisk (5 deps / 5 = 1.0) * 0.30 = 0.30 -> 0.945 total. Deterministic, so the
// "falls back locally" test can assert precisely on the emitted event instead
// of just "something happened".
const REAL_TASKS = [
  {
    taskId: "task-real-x1",
    baselineDurationMs: 86_400_000,
    varianceMs: 7_200_000,
    dependencies: ["d1", "d2", "d3", "d4", "d5"],
    isCriticalPath: true,
    assignedTo: "user-1",
    spiHistory: [0.1],
    resourceUtilization: 0.95,
    isCompleted: false,
  },
];

vi.mock("../src/modules/delay-forecast/repo.js", () => ({
  getProjectTasks: vi.fn(async () => REAL_TASKS),
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => {}),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
}));

interface StubQueueHandle {
  queue: Queue;
  published: Array<{ topic: string; msg: { payload: Record<string, unknown> } }>;
  getHandler: () => (msg: unknown) => Promise<void>;
}

function makeStubQueue(): StubQueueHandle {
  let capturedHandler: ((msg: unknown) => Promise<void>) | undefined;
  const published: Array<{ topic: string; msg: { payload: Record<string, unknown> } }> = [];
  const queue = {
    subscribe: (_topic: string, handler: (msg: unknown) => Promise<void>) => {
      capturedHandler = handler;
    },
    publish: async (topic: string, msg: { payload: Record<string, unknown> }) => {
      published.push({ topic, msg });
    },
  } as unknown as Queue;
  return { queue, published, getHandler: () => capturedHandler! };
}

function taskUpdatedMessage() {
  return {
    messageId: `msg-${Math.random()}`,
    correlationId: "corr-1",
    tenantId: TENANT,
    actorId: "actor-1",
    payload: { taskId: TASK_ID, projectId: PROJECT_ID, tenantId: TENANT },
  };
}

describe("Delay forecast consumer — project.task.updated", () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret-for-dom-017");
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("SABOTAGE CHECK: sends the REAL task graph to ml-service's real endpoint, not a bogus {taskId, trigger} payload", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: { tasks?: Array<{ taskId: string }> } | undefined;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/v1/ml/internal/delay-forecast/simulate")) {
        capturedUrl = url;
        capturedBody = JSON.parse((init?.body as string) ?? "{}");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: {
              p50Ms: 1, p80Ms: 2, p95Ms: 3,
              taskRisks: [{ taskId: "task-real-x1", riskScore: 0.9, factors: ["x"] }],
              bottlenecks: [],
            },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof fetch;

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    await getHandler()(taskUpdatedMessage());

    expect(capturedUrl).toContain("/v1/ml/internal/delay-forecast/simulate");
    expect(capturedBody?.tasks?.map((t) => t.taskId)).toEqual(["task-real-x1"]);
    // ML succeeded and returned a >0.80 risk -> event uses the ML response.
    expect(published).toHaveLength(1);
    expect(published[0]!.msg.payload.entityId).toBe("task-real-x1");
    expect(published[0]!.msg.payload.prediction).toBe(0.9);
  });

  it("falls back to computeTaskRiskScores over the REAL tasks when ml-service is unreachable — not a silent skip", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3032")) as unknown as typeof fetch;

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    await getHandler()(taskUpdatedMessage());

    // Old behavior: logged "ML unavailable... skipping risk re-evaluation"
    // and returned with ZERO events published, indistinguishable from "no
    // risk found". New behavior: computes locally and still emits the
    // high-risk event for task-real-x1 (score 0.945, deterministic — see
    // REAL_TASKS comment above).
    expect(published).toHaveLength(1);
    expect(published[0]!.msg.payload.entityId).toBe("task-real-x1");
    expect(published[0]!.msg.payload.prediction).toBeCloseTo(0.945, 3);
  });

  it("skips cleanly (no publish) when the project has no tasks — never fabricates risk", async () => {
    const repoModule = await import("../src/modules/delay-forecast/repo.js");
    vi.mocked(repoModule.getProjectTasks).mockResolvedValueOnce([]);

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    await getHandler()(taskUpdatedMessage());

    expect(published).toHaveLength(0);
  });
});
