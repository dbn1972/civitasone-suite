/**
 * TX-001 (journey-service slice) — executions module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `journey executions:165`, which matched exactly on review):
 * inside executionAdvance's already-open db.transaction(), the non-completing
 * advance path called journeyRepo.findById(p.journeyId, msg.tenantId) --
 * a scopedRead()-based read that opens its OWN db.transaction() -- from
 * INSIDE the outer one, to resolve the next step to dispatch. Under pool.max
 * concurrent in-flight consumer transactions, every one of them needs a
 * second ("nested") pool connection at the same moment none is free,
 * deadlocking the whole queue silently forever.
 *
 * This test exercises executionAdvance (journey.execution.advance) at
 * pool.max + 3 concurrency, real Postgres, real pool, each command advancing
 * a distinct execution enrolled in its own distinct journey (avoiding
 * row-lock serialization so the test isolates the pool-connection deadlock
 * specifically). Each advance targets a non-terminal transition (enrolled ->
 * in_progress), which is the branch that reaches the nested journey lookup.
 *
 * Fixed by routing onto journeyRepo.findByIdTx(tx, ...), reading through the
 * caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { journeys } from "../src/modules/journeys/schema.js";
import { journeyExecutions } from "../src/modules/executions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerExecutionConsumers } from "../src/modules/executions/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7a001000-dead-4000-8000-000000000001";
const ACTOR = "7a001000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const TOTAL_STEPS = 3;

const JOURNEY_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());
const EXECUTION_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());
const PROFILE_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the production
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring decorates `subscribe()` so every
 * consumer handler runs inside `runWithTenant(msg.tenantId, ...)`, which is
 * what lets `db.transaction()` pick up the tenant GUC. Mirror that here.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.executionAdvance, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed (markProcessed's idempotency ledger) has no tenant_id
      // column -- it is keyed only by messageId, which this test always
      // generates fresh via randomUUID(), so there is nothing tenant-scoped
      // to clean up here (matching the install-service TX-001 sibling test).
      await tx.delete(journeyExecutions).where(eq(journeyExecutions.tenantId, TENANT));
      await tx.delete(journeys).where(eq(journeys.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  // One INDEPENDENT journey + execution pair per concurrent command, so all
  // CONCURRENCY advances can legitimately run at once -- a realistic
  // trigger, not an artificial one requiring the fix's own locking to
  // serialize them.
  const stepDefs = Array.from({ length: TOTAL_STEPS }, (_, i) => ({
    type: "wait",
    config: { delaySeconds: 1, label: `step-${i}` },
  }));

  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(journeys).values(
        JOURNEY_IDS.map((id) => ({
          id, tenantId: TENANT, name: "TX-001 deadlock fixture", status: "active",
          triggerConfig: null, steps: stepDefs, createdBy: ACTOR, updatedBy: ACTOR,
        })),
      );
      await tx.insert(journeyExecutions).values(
        EXECUTION_IDS.map((id, i) => ({
          id, tenantId: TENANT, journeyId: JOURNEY_IDS[i], profileId: PROFILE_IDS[i],
          status: "enrolled", currentStepIndex: 0, createdBy: ACTOR, updatedBy: ACTOR,
        })),
      );
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("executions consumer executionAdvance -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent executionAdvance commands on independent executions drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerExecutionConsumers(q);
      await q.start();

      await Promise.all(EXECUTION_IDS.map((_, i) =>
        q.publish(COMMANDS.executionAdvance, makeMsg(randomUUID(), {
          journeyId: JOURNEY_IDS[i],
          profileId: PROFILE_IDS[i],
          fromStepIndex: 0,
          totalSteps: TOTAL_STEPS,
          outcome: "advance",
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(journeyExecutions)
          .where(inArray(journeyExecutions.id, EXECUTION_IDS))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.status, "execution " + row.id + " should have advanced to in_progress -- a stale 'enrolled' status means the advance silently no-op'd instead of genuinely applying (or the nested journey lookup deadlocked and the transaction never committed)").toBe("in_progress");
        expect(row.currentStepIndex).toBe(1);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
