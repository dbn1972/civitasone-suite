/**
 * inspection-service riskScoreCompute nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1, on a re-scan after fixing a scanner limitation (a cache-wrapped
 * function with an inline generic type argument like
 * `cache.getOrLoad<RiskModelRow>(...)` and object-literal return types hid
 * these from the earlier per-service passes): the riskScoreCompute command
 * handler (risk/consumer.ts) opens db.transaction() and calls
 * repo.findModelById / repo.findActiveModelByTenant / repo.findScoreByEntity
 * -- cache-wrapped, scopedRead-based functions that each open their OWN
 * db.transaction() -- from INSIDE the already-open outer transaction.
 *
 * Fixed by routing onto findModelByIdTx / findActiveModelByTenantTx /
 * findScoreByEntityTx, reading through the caller's already-open tx (and
 * deliberately bypassing the read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerRiskConsumers } from "../src/modules/risk/consumer.js";
import { riskModels } from "../src/modules/risk/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "51500000-dead-4000-8000-0000005150a0";
const ACTOR = "51500000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

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

describe("inspection-service riskScoreCompute -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent riskScoreCompute commands (each against a real seeded active model) drain without deadlocking the connection pool`,
    async () => {
      const modelId = randomUUID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTenantScope(db, TENANT, (tx: any) => tx.insert(riskModels).values({
        id: modelId, tenantId: TENANT, name: "Deadlock Test Model",
        factors: [{ factorName: "test", weight: 1, scoringFunction: "linear", dataSource: "manual" }],
        isActive: 1, createdBy: ACTOR, updatedBy: ACTOR,
      }));

      const q = tenantWrappedQueue();
      registerRiskConsumers(q);
      await q.start();

      await Promise.all(Array.from({ length: CONCURRENCY }, () =>
        q.publish(COMMANDS.riskScoreCompute, makeMsg(COMMANDS.riskScoreCompute, {
          entityId: randomUUID(), modelId,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
