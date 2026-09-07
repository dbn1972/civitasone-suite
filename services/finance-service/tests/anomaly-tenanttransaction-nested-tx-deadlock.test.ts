/**
 * Regression test for the Section-1 nested-transaction connection-pool
 * deadlock, tenantTransaction/scopedRead variant (see
 * .claude/skills/16-production-readiness-audit.md): queries.isTransactionDismissed
 * used scopedRead(), which opens its OWN db.transaction(), called from
 * inside the anomaly consumer handlers own already-open outer
 * db.transaction(). With pool.max concurrent outer transactions in
 * flight, every one of them needs an extra (nested) pool connection at
 * the same moment none is free, deadlocking silently forever.
 *
 * Found during the tenantTransaction re-audit. Fixed by adding
 * isTransactionDismissedTx, a tx-scoped twin, and routing the
 * mlAnomalyDetected consumer handler (already inside db.transaction) onto
 * it. (A second call site, in the standalone exported
 * processTransactionForAnomalies, has zero callers anywhere in the repo --
 * confirmed dead code -- and was deliberately left on the original
 * non-Tx isTransactionDismissed.)
 *
 * MemoryQueue.deliver() never rejects -- a handler error is captured into
 * q.dlq instead of throwing -- so a bare drain() check alone would also
 * pass if every delivery silently failed before ever reaching the
 * nested-transaction call. Both assertions below (empty dlq, and the
 * expected anomaly rows actually landed) are required to prove the fix
 * path genuinely ran, not just that nothing hung.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerAnomalyConsumers } from "../src/modules/anomaly/consumer.js";
import { financeAnomalies } from "../src/modules/anomaly/schema.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";
const CONCURRENCY = 13;

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("anomaly consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent mlAnomalyDetected messages drain without deadlocking the connection pool`,
    async () => {
      const q = tenantWrappedQueue();
      registerAnomalyConsumers(q);
      await q.start();

      const entityIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      await Promise.all(entityIds.map((entityId) =>
        q.publish(CONSUMED_EVENTS.mlAnomalyDetected, makeMsg(CONSUMED_EVENTS.mlAnomalyDetected, {
          tenantId: TENANT,
          domain: "finance",
          entityId,
          anomalyType: "zscore",
          severity: "low",
          factors: [],
          timestamp: new Date().toISOString(),
          correlationId: randomUUID(),
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      expect(q.dlq, `handler(s) failed unexpectedly: ${JSON.stringify(q.dlq)}`).toEqual([]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select({ transactionId: financeAnomalies.transactionId }).from(financeAnomalies)
          .where(inArray(financeAnomalies.transactionId, entityIds)),
      );
      expect(rows.length, "isTransactionDismissedTx + createAnomalyFlagTx did not actually create the expected rows").toBe(CONCURRENCY);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
