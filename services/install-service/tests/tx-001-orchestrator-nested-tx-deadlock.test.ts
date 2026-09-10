/**
 * TX-001 (install-service slice) — orchestrator module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (the
 * evidence column undercounted this service too, same as estab/procurement):
 * `orchestrator/consumer.ts`'s stepStart/stepComplete/stepSkip handlers, and
 * the resolveDag() helper they call while inside their own already-open
 * db.transaction(), read step definitions/executions via
 * repo.getStepDefinitions()/repo.getStepExecutions() — both of which open
 * their OWN bare db.transaction() internally. Under pool.max concurrent
 * in-flight consumer transactions, every nested call needs a second pool
 * connection at the same moment none is free, deadlocking the whole queue
 * silently forever.
 *
 * This test exercises stepComplete (install.step.complete) on 13
 * independent steps of the SAME wizard at once — pool.max (10) + 3
 * concurrency, real Postgres, real pool — a realistic trigger (many step
 * handlers or operators finishing steps around the same moment).
 *
 * Fixed by routing every nested read onto repo.getStepDefinitionsTx(tx, ...)
 * / repo.getStepExecutionsTx(tx, ...), reading through the caller's
 * already-open tx (7 call sites: stepStart, stepComplete x2, stepSkip x2,
 * and resolveDag() x2 which stepComplete/stepSkip both call from inside
 * their transaction).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { wizardDefinitions, stepDefinitions, stepExecutions } from "../src/modules/orchestrator/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerOrchestratorConsumers } from "../src/modules/orchestrator/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "0121e000-dead-4000-8000-000000000121";
const OFFICER = "0121e000-dead-4000-8000-0000000ac70a";
const WIZARD = "0121e000-dead-4000-8000-0000000000fe";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const STEP_KEYS = Array.from({ length: CONCURRENCY }, (_, i) => `tx001-step-${i}`);

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

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(stepExecutions).where(eq(stepExecutions.tenantId, TENANT));
      await tx.delete(stepDefinitions).where(eq(stepDefinitions.tenantId, TENANT));
      await tx.delete(wizardDefinitions).where(eq(wizardDefinitions.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(wizardDefinitions).values({
        id: WIZARD, tenantId: TENANT, name: "TX-001 deadlock fixture",
        description: null, status: "active", createdBy: OFFICER, updatedBy: OFFICER, version: 1,
      });
      // 13 INDEPENDENT steps (no dependsOn) so all 13 stepComplete commands
      // can legitimately run at once -- a realistic trigger, not an
      // artificial one requiring the fix's own DAG ordering to serialize them.
      await tx.insert(stepDefinitions).values(
        STEP_KEYS.map((stepKey, i) => ({
          tenantId: TENANT, wizardId: WIZARD, stepKey,
          title: `Step ${i}`, description: null, isRequired: true, dependsOn: [],
          handlerType: "manual", config: {}, sortOrder: i,
          createdBy: OFFICER, updatedBy: OFFICER,
        })),
      );
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("orchestrator consumer stepComplete -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent stepComplete commands on independent steps of the same wizard drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerOrchestratorConsumers(q);
      await q.start();

      await Promise.all(STEP_KEYS.map((stepKey, i) =>
        q.publish(COMMANDS.stepComplete, makeMsg(COMMANDS.stepComplete, {
          wizardId: WIZARD, stepKey, output: { note: `done ${i}` },
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
        db.transaction((tx) => tx.select().from(stepExecutions)
          .where(inArray(stepExecutions.stepKey, STEP_KEYS))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.wizardId).toBe(WIZARD);
        expect(row.status).toBe("completed");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
