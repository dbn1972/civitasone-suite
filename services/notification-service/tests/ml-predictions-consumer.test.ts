/**
 * ML prediction → high-risk notification consumer (Req 22.5, 25.2).
 *
 * Had no coverage at all. Covers the risk-threshold gate for all four topics,
 * the review-URL map per domain, the notification content builder, and
 * idempotency.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { processed } from "../src/shared/outbox.js";
import { notifications } from "../src/modules/stream/schema.js";
import {
  registerMLPredictionConsumers,
  ML_PREDICTION_EVENTS,
} from "../src/modules/ml-predictions/consumer.js";

const TENANT = "a11c0001-1111-4000-8000-000000000001";
const ACTOR = "a11caaaa-1111-4000-8000-0000000000aa";
const ENTITY = "a11ce111-1111-4000-8000-0000000000e1";

/** Message ids this file has delivered, so cleanup stays scoped to them. */
const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(notifications).where(eq(notifications.tenantId, TENANT));
  }));
  // _inbox.processed is shared and not tenant-scoped: only remove this file's ids
  // so parallel test files keep their own idempotency markers.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: TENANT,
    domain: "tickets",
    entityId: ENTITY,
    prediction: 0.91,
    confidence: 0.88,
    factors: [{ feature: "age_hours", contribution: 0.4, direction: "positive" }],
    modelVersion: 3,
    timestamp: new Date().toISOString(),
    correlationId: "corr-ml-1",
    ...over,
  };
}

async function deliver(topic: string, messageId: string, p: Record<string, unknown>): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerMLPredictionConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: "corr-ml-1", schemaVersion: "1.0", payload: p,
  });
  await q.drain();
  await q.stop();
  return q;
}

async function stored() {
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(notifications).where(eq(notifications.tenantId, TENANT))));
}

beforeAll(cleanup);
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("ML prediction consumer — risk threshold gate", () => {
  it("breach risk above 0.70 persists a notification", async () => {
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, "a11c1111-1111-4000-8000-000000000101", payload({ prediction: 0.71 }));
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("SLA Breach Risk Detected");
    expect(rows[0]?.body).toContain("71%");
    expect(rows[0]?.type).toBe(ML_PREDICTION_EVENTS.breachRiskHigh);
    expect(rows[0]?.userId).toBe(ACTOR);
  });

  it("breach risk exactly at 0.70 does NOT notify (strictly greater)", async () => {
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, "a11c1111-1111-4000-8000-000000000102", payload({ prediction: 0.70 }));
    expect(await stored()).toHaveLength(0);
  });

  it("breach risk below the threshold does not notify", async () => {
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, "a11c1111-1111-4000-8000-000000000103", payload({ prediction: 0.4 }));
    expect(await stored()).toHaveLength(0);
  });

  it("task delay risk above 0.80 notifies", async () => {
    await deliver(ML_PREDICTION_EVENTS.taskHighRisk, "a11c1111-1111-4000-8000-000000000104",
      payload({ prediction: 0.85, domain: "tasks" }));
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("High Task Delay Risk");
  });

  it("task delay risk at 0.75 does not notify — the delay bar is higher than breach", async () => {
    await deliver(ML_PREDICTION_EVENTS.taskHighRisk, "a11c1111-1111-4000-8000-000000000105",
      payload({ prediction: 0.75, domain: "tasks" }));
    expect(await stored()).toHaveLength(0);
  });

  it("churn risk above 0.70 notifies", async () => {
    await deliver(ML_PREDICTION_EVENTS.churnRiskHigh, "a11c1111-1111-4000-8000-000000000106",
      payload({ prediction: 0.9, domain: "subscriptions" }));
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Subscription Churn Risk");
  });

  it("high-severity anomaly notifies regardless of the prediction value", async () => {
    await deliver(ML_PREDICTION_EVENTS.anomalyDetected, "a11c1111-1111-4000-8000-000000000107",
      payload({ prediction: 0.1, domain: "transactions", severity: "high" }));
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Financial Anomaly Detected");
    expect(rows[0]?.body).toContain("high severity");
  });

  it("medium-severity anomaly does not notify", async () => {
    await deliver(ML_PREDICTION_EVENTS.anomalyDetected, "a11c1111-1111-4000-8000-000000000108",
      payload({ prediction: 0.99, domain: "transactions", severity: "medium" }));
    expect(await stored()).toHaveLength(0);
  });

  it("low-severity anomaly does not notify", async () => {
    await deliver(ML_PREDICTION_EVENTS.anomalyDetected, "a11c1111-1111-4000-8000-000000000109",
      payload({ prediction: 0.99, domain: "transactions", severity: "low" }));
    expect(await stored()).toHaveLength(0);
  });

  it("an anomaly with no severity does not notify", async () => {
    await deliver(ML_PREDICTION_EVENTS.anomalyDetected, "a11c1111-1111-4000-8000-000000000110",
      payload({ prediction: 0.99, domain: "transactions" }));
    expect(await stored()).toHaveLength(0);
  });
});

describe("ML prediction consumer — review URL per domain", () => {
  const cases: Array<[string, string, string]> = [
    ["tickets", ML_PREDICTION_EVENTS.breachRiskHigh, `/helpdesk/tickets/${ENTITY}`],
    ["tasks", ML_PREDICTION_EVENTS.taskHighRisk, `/projects/${ENTITY}`],
    ["subscriptions", ML_PREDICTION_EVENTS.churnRiskHigh, `/billing/subscriptions/${ENTITY}`],
    ["transactions", ML_PREDICTION_EVENTS.anomalyDetected, `/finance/anomalies?entityId=${ENTITY}`],
    ["leads", ML_PREDICTION_EVENTS.churnRiskHigh, `/crm/deals/${ENTITY}`],
    ["inventory", ML_PREDICTION_EVENTS.churnRiskHigh, `/inventory/items/${ENTITY}`],
    ["something-else", ML_PREDICTION_EVENTS.churnRiskHigh, "/"],
  ];

  let seq = 200;
  for (const [domain, topic, expected] of cases) {
    it(`domain "${domain}" → ${expected}`, async () => {
      seq += 1;
      // Final UUID segment is 12 hex chars — pad, or Postgres rejects the id.
      await deliver(topic, `a11c2222-1111-4000-8000-${String(seq).padStart(12, "0")}`,
        payload({ domain, prediction: 0.95, severity: "high" }));
      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect((rows[0]?.metadata as { reviewUrl?: string }).reviewUrl).toBe(expected);
    });
  }
});

describe("ML prediction consumer — metadata and idempotency", () => {
  it("stores the contributing factors and confidence for the reviewer", async () => {
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, "a11c3333-1111-4000-8000-000000000301", payload());
    const meta = (await stored())[0]?.metadata as Record<string, unknown>;
    expect(meta.domain).toBe("tickets");
    expect(meta.entityId).toBe(ENTITY);
    expect(meta.confidence).toBe(0.88);
    expect(meta.prediction).toBe(0.91);
    expect(Array.isArray(meta.factors)).toBe(true);
  });

  it("processing the same messageId twice persists exactly one notification", async () => {
    const MSG = "a11c3333-1111-4000-8000-000000000302";
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, MSG, payload());
    const first = await stored();
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, MSG, payload());
    const second = await stored();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("does not leak into another tenant", async () => {
    await deliver(ML_PREDICTION_EVENTS.breachRiskHigh, "a11c3333-1111-4000-8000-000000000303", payload());
    const other = "a11c0002-2222-4000-8000-000000000002";
    const rows = await runWithTenant(other, () => db.transaction((tx) =>
      tx.select().from(notifications).where(eq(notifications.tenantId, TENANT))));
    expect(rows).toHaveLength(0);
  });
});
