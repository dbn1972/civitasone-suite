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
 * TX-009: the high-risk events used to be published directly via
 * queue.publish (bypassing the transactional outbox), with markProcessed
 * gating an early, separate transaction before the ml-service call. That
 * combination could silently drop a high-risk event forever (a crash or
 * publish failure after the early markProcessed commit left a genuine
 * redelivery looking like a no-op duplicate). The fix moved markProcessed to
 * gate a single transaction, run AFTER the ml-service call, that also
 * performs the outbox enqueues for both the risk events and the audit row.
 * `markProcessed` below is now a STATEFUL mock (tracks seen messageIds, like
 * the real Postgres-backed helper) instead of an unconditional `() => true`,
 * so the redelivery test further down actually proves the guard works
 * rather than assuming it.
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

// Stateful outbox mock: tracks messageIds actually "seen" by markProcessed,
// like the real Postgres-backed helper (ON CONFLICT DO NOTHING ... RETURNING)
// -- not a blanket `() => true` -- so redelivery tests genuinely exercise the
// dedup guard instead of assuming it. H.enqueueCalls records every enqueue()
// call so tests can assert on the outbox rows written, since TX-009 moved the
// high-risk events off queue.publish and onto enqueue().
const H = vi.hoisted(() => ({
  enqueueCalls: [] as Array<{ topic: string; payload: Record<string, unknown> }>,
  processedIds: new Set<string>(),
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, ev: { topic: string; payload: Record<string, unknown> }) => {
    H.enqueueCalls.push(ev);
  }),
  markProcessed: vi.fn(async (_tx: unknown, messageId: string) => {
    if (H.processedIds.has(messageId)) return false;
    H.processedIds.add(messageId);
    return true;
  }),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) },
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

function taskUpdatedMessage(messageId = `msg-${Math.random()}`) {
  return {
    messageId,
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
    H.enqueueCalls.length = 0;
    H.processedIds.clear();
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
    // TX-009: the high-risk event now goes through the transactional outbox
    // (enqueue), never a direct queue.publish.
    expect(published).toHaveLength(0);
    const riskEvents = H.enqueueCalls.filter((e) => e.topic === "ml.prediction.task_high_risk");
    expect(riskEvents).toHaveLength(1);
    expect(riskEvents[0]!.payload.entityId).toBe("task-real-x1");
    expect(riskEvents[0]!.payload.prediction).toBe(0.9);
    // Plus the audit row, in the SAME transaction.
    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1);
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
    // REAL_TASKS comment above) — via the outbox, not a direct publish.
    expect(published).toHaveLength(0);
    const riskEvents = H.enqueueCalls.filter((e) => e.topic === "ml.prediction.task_high_risk");
    expect(riskEvents).toHaveLength(1);
    expect(riskEvents[0]!.payload.entityId).toBe("task-real-x1");
    expect(riskEvents[0]!.payload.prediction).toBeCloseTo(0.945, 3);
  });

  it("skips cleanly (no publish, no enqueue) when the project has no tasks — never fabricates risk", async () => {
    const repoModule = await import("../src/modules/delay-forecast/repo.js");
    vi.mocked(repoModule.getProjectTasks).mockResolvedValueOnce([]);

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    await getHandler()(taskUpdatedMessage());

    expect(published).toHaveLength(0);
    expect(H.enqueueCalls).toHaveLength(0);
  });

  it("TX-009 regression: redelivering the SAME message (same messageId) does not double-enqueue the high-risk event", async () => {
    // Simulates a real at-least-once redelivery: the identical envelope
    // (same messageId) is handed to the consumer twice. Before the fix, the
    // real risk wasn't a double-fire on an EXACT redelivery (the early
    // markProcessed already blocked that) -- it was a permanent DROP when a
    // crash or publish failure landed between the early markProcessed commit
    // and the direct queue.publish call, which this stateful mock can't
    // literally reproduce (there's no crash to inject here) but which the
    // reordering fixes structurally: markProcessed and the enqueue now
    // commit together, so there is no gap in which "processed" is recorded
    // without the event also being durably queued. This test proves the
    // OTHER half of the contract still holds after that reordering: a clean
    // redelivery remains a clean no-op, not a double-enqueue.
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: {
          p50Ms: 1, p80Ms: 2, p95Ms: 3,
          taskRisks: [{ taskId: "task-real-x1", riskScore: 0.9, factors: ["x"] }],
          bottlenecks: [],
        },
      }),
    })) as unknown as typeof fetch;

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    const msg = taskUpdatedMessage("fixed-redelivery-id");
    await getHandler()(msg);
    await getHandler()(msg); // redelivery: identical messageId

    const riskEvents = H.enqueueCalls.filter((e) => e.topic === "ml.prediction.task_high_risk");
    expect(riskEvents).toHaveLength(1); // not 2
    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1); // not 2
    expect(published).toHaveLength(0);
  });

  it("review-fix regression: a genuine transaction/DB error propagates instead of being swallowed by the ML-failure catch", async () => {
    // This is the exact bug the independent review found: a PRE-EXISTING
    // outer try/catch (predating TX-009, written to degrade gracefully on an
    // ML-scoring failure specifically) ended up ALSO wrapping the TX-009
    // transaction once that was moved in. A DB/commit error inside it was
    // caught by that same catch, logged as if it were an ML failure, and
    // swallowed: the handler returned normally, the queue treated the
    // message as fully consumed, and the high-risk events + audit row were
    // lost silently and permanently, with no redelivery ever triggered.
    // Mocking db.transaction itself to reject (rather than making the ML
    // call fail) isolates exactly that: a failure that has NOTHING to do
    // with ml-service.
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: {
          p50Ms: 1, p80Ms: 2, p95Ms: 3,
          taskRisks: [{ taskId: "task-real-x1", riskScore: 0.9, factors: ["x"] }],
          bottlenecks: [],
        },
      }),
    })) as unknown as typeof fetch;

    const dbModule = await import("../src/shared/db.js");
    const dbError = new Error("connection terminated unexpectedly");
    vi.mocked(dbModule.db.transaction).mockRejectedValueOnce(dbError);

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    // The narrowed try/catch (scoped to ONLY the predictDelay call) must NOT
    // catch this -- it has to propagate out of the handler so the queue
    // knows to redeliver, instead of silently marking the message consumed.
    await expect(getHandler()(taskUpdatedMessage())).rejects.toThrow("connection terminated unexpectedly");
  });

  it("review-fix regression: an ML-call failure alone still degrades gracefully and does not propagate (contrast with the DB-error case above)", async () => {
    // Companion to the test above, proving the two failure modes are still
    // told apart correctly after narrowing the catch: an ML failure must
    // still complete the message normally (matching billing's churn
    // consumer pattern), while a DB/transaction failure (above) must not.
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3032")) as unknown as typeof fetch;

    const { registerDelayForecastConsumers } = await import("../src/modules/delay-forecast/consumer.js");
    const { queue, getHandler } = makeStubQueue();
    registerDelayForecastConsumers(queue);

    await expect(getHandler()(taskUpdatedMessage())).resolves.toBeUndefined();

    // Still falls back to local scoring and emits normally -- an ML failure
    // is not a reason to lose the risk event or the audit row.
    const riskEvents = H.enqueueCalls.filter((e) => e.topic === "ml.prediction.task_high_risk");
    expect(riskEvents).toHaveLength(1);
    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1);
  });
});
