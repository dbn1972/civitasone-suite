/**
 * COMP-007 -- notification-service `ml-predictions` module (high-risk ML
 * prediction events -> persisted notification + real-time SSE publish)
 * smoke test.
 *
 * Registered as a consumer only (registerMLPredictionConsumers, no HTTP
 * route) but had zero test references anywhere in the service. Follows this
 * campaign's established consumer-test convention (see procurement-service's
 * comp-007-clearance-consumer.test.ts): a fresh MemoryQueue per test, the
 * module's own `tenantScoped()` wrapper (applied internally by
 * registerMLPredictionConsumers itself, so no external wiring needed here --
 * confirmed by reading shared/tenant-queue.ts), drained via q.drain(),
 * verified against the real disposable Postgres (`stream.notifications` and
 * `_outbox.messages`) and the module's own real in-process pub/sub
 * (MemoryNotificationPublisher via setNotificationPublisherForTests --
 * real code, not a mock of the DB layer, the same substitution
 * clearance/vendor-scorecard's own service uses for its cache).
 *
 * No real bugs found: migration exists (migrations/0012_notifications_stream.sql),
 * and the file's own header comments document TWO already-fixed historical
 * bugs (a non-UUID system actor rejected by a NOT NULL uuid column, and
 * markProcessed committed outside the write's own transaction) -- both
 * confirmed fixed by reading the current code, nothing left to do.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "@civitasone/outbox";
import { notifications } from "../src/modules/stream/schema.js";
import { registerMLPredictionConsumers, ML_PREDICTION_EVENTS } from "../src/modules/ml-predictions/consumer.js";
import {
  setNotificationPublisherForTests,
  MemoryNotificationPublisher,
} from "../src/adapters/pubsub.js";

function envelope(
  payload: Record<string, unknown>,
  tenantId: string,
  actorId: string,
  correlationId: string,
  messageId = randomUUID(),
) {
  return { messageId, type: "ml.prediction", tenantId, actorId, correlationId, schemaVersion: "1.0", payload };
}

async function outboxRowsForCorrelation(correlationId: string) {
  return db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, correlationId));
}

/**
 * FORCE RLS on stream.notifications means a bare db.select() with no tenant
 * GUC set matches zero rows regardless of the WHERE clause. `db` here is
 * wrapWithTenantGuc()-wrapped (packages/db/src/wrap-tenant-db.ts): only
 * db.transaction() calls get the GUC auto-injected (from AsyncLocalStorage),
 * a bare .select() never does -- confirmed directly (runWithTenant alone,
 * without also wrapping the read in db.transaction(), still read back zero
 * rows against a write the consumer's own log proved had succeeded). Both
 * layers are needed together, matching the exact pattern metadata-service's
 * shared/scope.ts documents for the same reason.
 */
async function notificationsForTenant(tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(notifications).where(eq(notifications.tenantId, tenantId))),
  );
}

let publisher: MemoryNotificationPublisher;

beforeEach(() => {
  publisher = new MemoryNotificationPublisher();
  setNotificationPublisherForTests(publisher);
});

afterEach(() => {
  setNotificationPublisherForTests(null);
});

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: ml-predictions consumer -- ml.prediction.breach_risk_high", () => {
  it("above threshold: persists a notification, publishes via SSE, and emits one audit event", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;
    const entityId = randomUUID();

    const q = new MemoryQueue();
    registerMLPredictionConsumers(q);
    await q.start();

    await q.publish(
      ML_PREDICTION_EVENTS.breachRiskHigh,
      envelope(
        {
          tenantId: TENANT, domain: "tickets", entityId, prediction: 0.85, confidence: 0.9,
          factors: [{ feature: "sla_history", contribution: 0.4, direction: "positive" }],
          modelVersion: 1, timestamp: new Date().toISOString(), correlationId: CORR,
        },
        TENANT, ACTOR, CORR,
      ),
    );
    await q.drain();

    const rows = await notificationsForTenant(TENANT);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(ML_PREDICTION_EVENTS.breachRiskHigh);
    expect(rows[0].title).toBe("SLA Breach Risk Detected");
    expect((rows[0].metadata as any).entityId).toBe(entityId);
    expect((rows[0].metadata as any).reviewUrl).toBe(`/helpdesk/tickets/${entityId}`);

    const published = publisher.messages.get(`notifications:${TENANT}:${ACTOR}`);
    expect(published).toHaveLength(1);
    expect(JSON.parse(published![0]).title).toBe("SLA Breach Risk Detected");

    const audit = await outboxRowsForCorrelation(CORR);
    expect(audit).toHaveLength(1);
    expect(audit[0].payload).toMatchObject({ service: "notification-service", resourceType: "ml_predictions", outcome: "success" });
  });

  it("below threshold: no notification, no SSE publish, but the message is still consumed (no error)", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;

    const q = new MemoryQueue();
    registerMLPredictionConsumers(q);
    await q.start();

    await q.publish(
      ML_PREDICTION_EVENTS.breachRiskHigh,
      envelope(
        {
          tenantId: TENANT, domain: "tickets", entityId: randomUUID(), prediction: 0.50, confidence: 0.9,
          factors: [], modelVersion: 1, timestamp: new Date().toISOString(), correlationId: CORR,
        },
        TENANT, ACTOR, CORR,
      ),
    );
    await q.drain();

    expect(await notificationsForTenant(TENANT)).toHaveLength(0);
    expect(publisher.messages.size).toBe(0);
  });

  it("is idempotent: redelivering the same messageId does not create a second notification or a second audit event", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;
    const messageId = randomUUID();

    const q = new MemoryQueue();
    registerMLPredictionConsumers(q);
    await q.start();

    const env = envelope(
      {
        tenantId: TENANT, domain: "tasks", entityId: randomUUID(), prediction: 0.95, confidence: 0.9,
        factors: [], modelVersion: 1, timestamp: new Date().toISOString(), correlationId: CORR,
      },
      TENANT, ACTOR, CORR, messageId,
    );
    await q.publish(ML_PREDICTION_EVENTS.taskHighRisk, env);
    await q.publish(ML_PREDICTION_EVENTS.taskHighRisk, env); // exact same messageId, replayed
    await q.drain();

    expect(await notificationsForTenant(TENANT)).toHaveLength(1);
    expect(await outboxRowsForCorrelation(CORR)).toHaveLength(1);
  });

  it("anomaly events are gated by severity, not the numeric prediction score", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();

    const q = new MemoryQueue();
    registerMLPredictionConsumers(q);
    await q.start();

    // High prediction score but low severity -- should NOT notify.
    const corrLow = `corr-${randomUUID()}`;
    await q.publish(
      ML_PREDICTION_EVENTS.anomalyDetected,
      envelope(
        {
          tenantId: TENANT, domain: "transactions", entityId: randomUUID(), prediction: 0.99, confidence: 0.9,
          factors: [], modelVersion: 1, timestamp: new Date().toISOString(), correlationId: corrLow, severity: "low",
        },
        TENANT, ACTOR, corrLow,
      ),
    );
    await q.drain();
    expect(await notificationsForTenant(TENANT)).toHaveLength(0);

    // Low prediction score but high severity -- SHOULD notify.
    const corrHigh = `corr-${randomUUID()}`;
    await q.publish(
      ML_PREDICTION_EVENTS.anomalyDetected,
      envelope(
        {
          tenantId: TENANT, domain: "transactions", entityId: randomUUID(), prediction: 0.01, confidence: 0.9,
          factors: [], modelVersion: 1, timestamp: new Date().toISOString(), correlationId: corrHigh, severity: "high",
        },
        TENANT, ACTOR, corrHigh,
      ),
    );
    await q.drain();
    expect(await notificationsForTenant(TENANT)).toHaveLength(1);
  });

  it("is tenant-scoped: a notification created for tenant A is not visible reading back under tenant B", async () => {
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;

    const q = new MemoryQueue();
    registerMLPredictionConsumers(q);
    await q.start();

    await q.publish(
      ML_PREDICTION_EVENTS.churnRiskHigh,
      envelope(
        {
          tenantId: TENANT_A, domain: "subscriptions", entityId: randomUUID(), prediction: 0.99, confidence: 0.9,
          factors: [], modelVersion: 1, timestamp: new Date().toISOString(), correlationId: CORR,
        },
        TENANT_A, ACTOR, CORR,
      ),
    );
    await q.drain();

    expect(await notificationsForTenant(TENANT_A)).toHaveLength(1);
    expect(await notificationsForTenant(TENANT_B)).toHaveLength(0);
  });
});
