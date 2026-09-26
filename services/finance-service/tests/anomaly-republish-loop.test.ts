/**
 * Regression test for the finance-service unbounded self-republish loop
 * (incident, 2026-09): registerAnomalyConsumers' handler for
 * CONSUMED_EVENTS.mlAnomalyDetected ("ml.prediction.anomaly_detected")
 * calls createAnomalyFlagTx to persist a local finance_anomalies flag row.
 * createAnomalyFlagTx used to ALSO enqueue() a brand-new outbox message back
 * onto that SAME topic -- "announcing" the detection it had just consumed.
 * Since this consumer's own outbox relay (startRelay/relayOnce, 500ms poll
 * in production) picks up unpublished _outbox.messages rows and republishes
 * them to the queue, and the same consumer is subscribed to that exact
 * topic, one seeded message fed itself forever: confirmed live (real
 * worker.ts + real outbox relay, QUEUE_DRIVER=memory) growing from 1 seed to
 * 223 messages / 222 finance_anomalies rows in 113s (~2/sec, matching the
 * relay's 500ms interval), still climbing when stopped.
 *
 * The existing nested-tx-deadlock test above (same describe file group)
 * publishes straight to an in-test MemoryQueue and calls q.drain() without
 * ever starting the outbox relay, so it only ever exercised "consume ->
 * insert new outbox row", never "relay republishes that row -> consumer
 * consumes it again" -- which is exactly why that suite never caught this.
 * This test wires relayOnce() in too, closing that gap.
 *
 * Fix: createAnomalyFlagTx no longer re-enqueues ml.prediction.anomaly_detected.
 * It only persists the local flag row -- the event was already announced by
 * whoever published the message this consumer is handling. createAnomalyFlag
 * (the non-tx sibling, used by the local Z-score detection path in
 * processTransactionForAnomalies) is unaffected and still publishes, since
 * that path represents a genuinely NEW detection nobody has announced yet.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce, outboxMessages } from "@civitasone/outbox";
import { db } from "../src/shared/db.js";
import { registerAnomalyConsumers } from "../src/modules/anomaly/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "10000000-0000-4000-8000-000000000099";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

describe("anomaly consumer -- self-republish loop (real DB, no mocks)", () => {
  it(
    "consuming one ml.prediction.anomaly_detected message never causes a new one on the same topic, across repeated relay cycles",
    async () => {
      const q = tenantWrappedQueue();
      registerAnomalyConsumers(q);
      await q.start();

      const entityId = randomUUID();
      await q.publish(
        CONSUMED_EVENTS.mlAnomalyDetected,
        makeMsg(CONSUMED_EVENTS.mlAnomalyDetected, {
          tenantId: TENANT,
          domain: "finance",
          entityId,
          anomalyType: "zscore",
          severity: "high",
          factors: [],
          timestamp: new Date().toISOString(),
          correlationId: randomUUID(),
        }),
      );
      await q.drain();
      expect(q.dlq, `initial consume failed: ${JSON.stringify(q.dlq)}`).toEqual([]);

      // Close the exact gap that let this bug ship: unlike a bare drain()
      // after a direct publish(), the real worker also runs the outbox
      // relay on a 500ms interval (see startRelay in src/worker.ts). If the
      // consumer ever re-enqueues onto its own topic, each relay cycle
      // finds and republishes a new row, forever. Five cycles is enough to
      // prove the loop is gone without an open-ended wait.
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await relayOnce(db as any, q, 100, "finance-service-test");
        await q.drain();
        expect(q.dlq, `relay cycle ${i}: handler failed: ${JSON.stringify(q.dlq)}`).toEqual([]);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anomalyTopicRows = await withTenantScope(db, TENANT, (tx: any) =>
        tx
          .select({ id: outboxMessages.id })
          .from(outboxMessages)
          .where(and(eq(outboxMessages.topic, CONSUMED_EVENTS.mlAnomalyDetected), eq(outboxMessages.tenantId, TENANT))),
      );
      expect(
        anomalyTopicRows.length,
        "createAnomalyFlagTx (or something else in the consume path) re-enqueued " +
          "ml.prediction.anomaly_detected -- self-republish loop regressed. The one " +
          "message this test published directly (never through enqueue()/the outbox) " +
          "must be the ONLY thing ever seen on this topic.",
      ).toBe(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalRows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select({ id: outboxMessages.id }).from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
      );
      expect(
        totalRows.length,
        `expected only the one audit.event.record side-effect from processing the ` +
          `single message, got ${totalRows.length} total outbox rows for this tenant ` +
          `-- unbounded growth regressed`,
      ).toBeLessThanOrEqual(1);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
