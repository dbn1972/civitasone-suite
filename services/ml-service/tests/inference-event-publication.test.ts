/**
 * Inference event publication contract tests.
 *
 * The prediction outbox row is the only thing that reaches downstream services:
 * `packages/outbox` relays with `queue.publish(row.topic, ...)`, so `topic` is the
 * routing key. notification-service (`modules/ml-predictions/consumer.ts`) and
 * plugin-service subscribe to the per-domain `ml.prediction.*` topics, so a
 * prediction published under any other topic is silently dropped.
 *
 * Validates: Requirements 22.5, 25.2 (cross-service prediction delivery)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EVENTS } from "../src/topics.js";

interface EnqueuedEvent {
  topic: string;
  eventType: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  enqueued: [] as EnqueuedEvent[],
  prediction: 0.85,
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
        insert: () => ({ values: async () => [{}] }),
      }),
  },
  sqlClient: {},
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_key: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, e: EnqueuedEvent) => {
    h.enqueued.push(e);
  },
  markProcessed: async () => true,
}));

vi.mock("../src/modules/model-registry/domain.js", () => ({
  getCurrentModel: async (tenantId: string, domain: string) => ({
    id: `model-${domain}`,
    tenantId,
    domain,
    version: 7,
    status: "active",
    s3Key: `ml-models/${tenantId}/${domain}/7/model.json`,
    trainedAt: new Date("2026-01-01T00:00:00Z"),
    recordCount: 5000,
    metrics: { auc: 0.82, precision: 0.75, recall: 0.71, f1: 0.73 },
    featureList: ["featureA", "featureB"],
    modelCard: null,
  }),
}));

vi.mock("../src/modules/feature-store/domain.js", () => ({
  getFeatureVector: async () => null,
}));

vi.mock("../src/modules/algorithms/logistic-regression.js", () => ({
  predictLogistic: () => h.prediction,
  computeFeatureImportance: () => [
    { feature: "featureA", contribution: 0.6, direction: "positive" as const },
    { feature: "featureB", contribution: 0.4, direction: "negative" as const },
  ],
}));

const { predict, invalidateModelCache } = await import("../src/modules/inference/domain.js");

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ENTITY_ID = "22222222-2222-2222-2222-222222222222";
const FEATURES = { featureA: 1, featureB: 2 };

type Domain = "leads" | "tickets" | "inventory" | "subscriptions" | "tasks" | "transactions";

async function predictFor(domain: Domain, correlationId = "corr-1"): Promise<EnqueuedEvent> {
  invalidateModelCache(TENANT_ID, domain);
  h.enqueued.length = 0;
  await predict({ tenantId: TENANT_ID, domain, entityId: ENTITY_ID, features: FEATURES }, correlationId);
  expect(h.enqueued).toHaveLength(1);
  return h.enqueued[0]!;
}

describe("prediction event publication", () => {
  beforeEach(() => {
    process.env.FEATURE_ML_ENABLED = "true";
    h.prediction = 0.85;
    h.enqueued.length = 0;
  });

  describe("outbox topic is the domain-specific routing key", () => {
    const cases: Array<[Domain, string]> = [
      ["leads", EVENTS.leadScored],
      ["tickets", EVENTS.breachRiskHigh],
      ["inventory", EVENTS.stockoutRisk],
      ["subscriptions", EVENTS.churnRiskHigh],
      ["tasks", EVENTS.taskHighRisk],
      ["transactions", EVENTS.anomalyDetected],
    ];

    for (const [domain, expectedTopic] of cases) {
      it(`publishes ${domain} predictions on ${expectedTopic}`, async () => {
        const event = await predictFor(domain);
        expect(event.topic).toBe(expectedTopic);
        expect(event.eventType).toBe(expectedTopic);
      });
    }

    it("does not publish every domain under the lead_scored topic", async () => {
      const topics = new Set<string>();
      for (const [domain] of cases) {
        topics.add((await predictFor(domain)).topic);
      }
      expect(topics.size).toBe(cases.length);
    });

    it("keeps the domain-specific topic on the fallback path", async () => {
      process.env.FEATURE_ML_ENABLED = "false";
      h.enqueued.length = 0;
      await predict(
        { tenantId: TENANT_ID, domain: "tickets", entityId: ENTITY_ID, features: FEATURES },
        "corr-fallback",
      );
      expect(h.enqueued).toHaveLength(1);
      expect(h.enqueued[0]!.topic).toBe(EVENTS.breachRiskHigh);
      expect(h.enqueued[0]!.payload.prediction).toBeNull();
      expect(h.enqueued[0]!.payload.fallback).toBe(true);
    });
  });

  describe("payload shape consumed by notification-service", () => {
    it("carries the fields the consumer reads", async () => {
      const event = await predictFor("tickets", "corr-shape");

      expect(event.payload).toMatchObject({
        tenantId: TENANT_ID,
        domain: "tickets",
        entityId: ENTITY_ID,
        prediction: 0.85,
        modelVersion: 7,
        correlationId: "corr-shape",
      });
      expect(typeof event.payload.confidence).toBe("number");
      expect(Array.isArray(event.payload.factors)).toBe(true);
      expect(typeof event.payload.timestamp).toBe("string");
      expect(event.correlationId).toBe("corr-shape");
      expect(event.tenantId).toBe(TENANT_ID);
    });

    it("propagates correlationId from the caller", async () => {
      const event = await predictFor("leads", "corr-xyz-123");
      expect(event.correlationId).toBe("corr-xyz-123");
      expect(event.payload.correlationId).toBe("corr-xyz-123");
    });
  });

  describe("anomaly severity for the transactions domain", () => {
    it("emits severity high above the 0.70 threshold so the consumer alerts", async () => {
      h.prediction = 0.91;
      const event = await predictFor("transactions");
      expect(event.topic).toBe(EVENTS.anomalyDetected);
      expect(event.payload.severity).toBe("high");
    });

    it("emits severity medium between 0.40 and 0.70", async () => {
      h.prediction = 0.55;
      expect((await predictFor("transactions")).payload.severity).toBe("medium");
    });

    it("emits severity low at or below 0.40", async () => {
      h.prediction = 0.2;
      expect((await predictFor("transactions")).payload.severity).toBe("low");
    });

    it("does not attach severity to non-anomaly domains", async () => {
      const event = await predictFor("tickets");
      expect(event.payload).not.toHaveProperty("severity");
    });
  });
});
