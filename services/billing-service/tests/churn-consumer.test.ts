/**
 * Churn consumer tests — billing.subscription.updated -> churn risk re-evaluation.
 *
 * TX-009: this consumer used to publish ml.prediction.churn_risk_high
 * directly via queue.publish, with markProcessed gating its own early
 * transaction (alongside the audit row) BEFORE the ml-service call. That
 * left a dual-write hole: a crash (or even just a failed queue.publish call)
 * anywhere after the early markProcessed commit permanently dropped the
 * churn-risk-high event, since a genuine redelivery of the same message
 * would see markProcessed return false and skip re-evaluation entirely --
 * a silent, unrecoverable drop of a revenue-risk signal. Fixed by moving
 * markProcessed to gate a single transaction, run AFTER the ml-service call,
 * that also performs the resulting outbox enqueues.
 *
 * `markProcessed` below is a STATEFUL mock (tracks seen messageIds, like the
 * real Postgres-backed helper) instead of an unconditional `() => true`, so
 * the redelivery test genuinely proves the guard works. Mirrors the mocking
 * style of project-service's delay-forecast-consumer.test.ts, the closest
 * structural analog in this codebase (same shape: tenantScoped queue,
 * circuit-breaker-wrapped ML adapter, direct-publish-on-high-risk bug).
 *
 * Uses a stub Queue (captures the subscribed handler) and mocks only the
 * network boundary (global.fetch) plus the outbox/db housekeeping calls --
 * classifyRiskLevel/fallbackChurnScore (domain.ts) run for real, since
 * they're pure functions with no side effects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Queue } from "@civitasone/queue";

const TENANT = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SUBSCRIPTION_ID = "33333333-3333-3333-3333-333333333333";

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

function subscriptionUpdatedMessage(messageId = `msg-${Math.random()}`) {
  return {
    messageId,
    correlationId: "corr-1",
    tenantId: TENANT,
    actorId: "actor-1",
    payload: { subscriptionId: SUBSCRIPTION_ID, tenantId: TENANT },
  };
}

function mockMlFetch(prediction: number) {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/v1/ml/predict")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          prediction, confidence: 0.8, factors: [{ feature: "usageScore", contribution: 0.3, direction: "negative" }],
          fallback: false, advisory: true,
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  }) as unknown as typeof fetch;
}

describe("Churn consumer — billing.subscription.updated", () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");
    H.enqueueCalls.length = 0;
    H.processedIds.clear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("high risk (ML prediction > 0.70): enqueues the churn-high event + audit through the outbox, never a direct publish", async () => {
    global.fetch = mockMlFetch(0.9);

    const { registerChurnConsumers } = await import("../src/modules/churn/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerChurnConsumers(queue);

    await getHandler()(subscriptionUpdatedMessage());

    // TX-009: no direct queue.publish for the risk signal.
    expect(published).toHaveLength(0);
    const riskEvents = H.enqueueCalls.filter((e) => e.topic === "ml.prediction.churn_risk_high");
    expect(riskEvents).toHaveLength(1);
    expect(riskEvents[0]!.payload.entityId).toBe(SUBSCRIPTION_ID);
    expect(riskEvents[0]!.payload.prediction).toBe(0.9);
    // Audit row lands in the SAME transaction.
    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1);
  });

  it("low/medium risk: only the audit row is enqueued, no churn-high event", async () => {
    global.fetch = mockMlFetch(0.2);

    const { registerChurnConsumers } = await import("../src/modules/churn/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerChurnConsumers(queue);

    await getHandler()(subscriptionUpdatedMessage());

    expect(published).toHaveLength(0);
    expect(H.enqueueCalls.filter((e) => e.topic === "ml.prediction.churn_risk_high")).toHaveLength(0);
    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1);
  });

  it("ml-service unreachable: still marks processed and records the audit row -- not a silent skip -- but classifies no risk", async () => {
    // This is the pre-existing (and unchanged by TX-009) contract: a thrown
    // ML error means no risk is ever classified and no churn-high event
    // fires, but the message must still be marked processed and audited --
    // that used to happen unconditionally in an early transaction, BEFORE
    // the ML call ran at all. Moving the audit into the same transaction as
    // the (now-fixed) high-risk enqueue could easily have regressed that
    // guarantee (an early draft of this fix did exactly that: a thrown
    // predictChurn error skipped straight to the outer catch and never
    // reached the audit enqueue). This proves the audit still fires even
    // when ML evaluation itself throws.
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3032")) as unknown as typeof fetch;

    const { registerChurnConsumers } = await import("../src/modules/churn/consumer.js");
    const { queue, getHandler } = makeStubQueue();
    registerChurnConsumers(queue);

    await getHandler()(subscriptionUpdatedMessage());

    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1);
    expect(H.enqueueCalls.filter((e) => e.topic === "ml.prediction.churn_risk_high")).toHaveLength(0);
  });

  it("ML disabled (FEATURE_ML_ENABLED unset): falls back to rule-based scoring, still audits", async () => {
    // predictChurn short-circuits to null when the feature flag is off (no
    // fetch call at all) -- the OTHER path into fallbackChurnScore, as
    // opposed to a thrown network error above. Fixed stub features score low
    // risk, so still just the audit row.
    vi.stubEnv("FEATURE_ML_ENABLED", "false");
    global.fetch = vi.fn(() => { throw new Error("must not call ml-service when disabled"); }) as unknown as typeof fetch;

    const { registerChurnConsumers } = await import("../src/modules/churn/consumer.js");
    const { queue, getHandler } = makeStubQueue();
    registerChurnConsumers(queue);

    await getHandler()(subscriptionUpdatedMessage());

    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1);
    expect(H.enqueueCalls.filter((e) => e.topic === "ml.prediction.churn_risk_high")).toHaveLength(0);
  });

  it("TX-009 regression: redelivering the SAME message (same messageId) does not double-enqueue the churn-high event", async () => {
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
    global.fetch = mockMlFetch(0.9);

    const { registerChurnConsumers } = await import("../src/modules/churn/consumer.js");
    const { queue, published, getHandler } = makeStubQueue();
    registerChurnConsumers(queue);

    const msg = subscriptionUpdatedMessage("fixed-redelivery-id");
    await getHandler()(msg);
    await getHandler()(msg); // redelivery: identical messageId

    const riskEvents = H.enqueueCalls.filter((e) => e.topic === "ml.prediction.churn_risk_high");
    expect(riskEvents).toHaveLength(1); // not 2
    expect(H.enqueueCalls.filter((e) => e.topic === "audit.event.record")).toHaveLength(1); // not 2
    expect(published).toHaveLength(0);
  });
});
