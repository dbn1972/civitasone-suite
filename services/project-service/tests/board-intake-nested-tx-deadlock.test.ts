/**
 * TX-001 (project-service slice) — board-intake module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (independently
 * re-verified with scan_nested_tx_v2.py plus a manual trace of every
 * db.transaction()/tenantTransaction() block in project-service): the
 * board-intake module's boardIntakeAccept and boardIntakeReject consumers both
 * called repo.findById(tenantId, id) — a db.transaction()-based read that opens
 * its OWN transaction — from INSIDE an already-open outer db.transaction() in
 * the consumer. Under pool.max concurrent in-flight consumer transactions,
 * every one of them needs a second ("nested") pool connection at the same
 * moment none is free, deadlocking the whole queue silently forever.
 *
 * This test exercises boardIntakeAccept (project.board_intake.accept) at
 * pool.max + 3 concurrency, real Postgres, real pool, many officers accepting
 * different pending-review intake items at once (a realistic trigger — a
 * batch of board decisions gets triaged together).
 *
 * Fixed by routing onto repo.findByIdTx(tx, ...), reading through the
 * caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { projectBoardDecisionIntake } from "../src/modules/board-intake/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerBoardIntakeConsumers } from "../src/modules/board-intake/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "b0a4d000-dead-4000-8000-0000000b0a4d";
const OFFICER = "b0a4d000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the production
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring decorates `subscribe()` so every
 * consumer handler runs inside `runWithTenant(msg.tenantId, ...)`, which is
 * what lets `db.transaction()` pick up the tenant GUC. Mirror that here.
 * (registerBoardIntakeConsumers also wraps the queue internally via
 * tenantScoped() and the handler itself calls runWithTenant() explicitly —
 * this extra layer is redundant-but-harmless belt-and-braces, matching the
 * pattern already established for the estab/procurement TX-001 slices.)
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.boardIntakeAccept, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(projectBoardDecisionIntake).where(eq(projectBoardDecisionIntake.tenantId, TENANT));
    }),
  );
}

const intakeIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      for (const [i, id] of intakeIds.entries()) {
        await tx.insert(projectBoardDecisionIntake).values({
          id,
          tenantId: TENANT,
          source: "meeting",
          decisionId: randomUUID(),
          meetingId: randomUUID(),
          text: `TX-001 deadlock fixture decision ${i}`,
          projectRef: null,
          authority: "Empowered Committee",
          status: "pending_review",
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("board-intake consumer boardIntakeAccept -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent boardIntakeAccept commands (distinct intake items, same tenant) drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerBoardIntakeConsumers(q);
      await q.start();

      await Promise.all(intakeIds.map((id) =>
        q.publish(COMMANDS.boardIntakeAccept, makeMsg(randomUUID(), {
          id, tenantId: TENANT, note: "batch-accepted",
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
        db.transaction((tx) => tx.select().from(projectBoardDecisionIntake).where(inArray(projectBoardDecisionIntake.id, intakeIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.status).toBe("accepted");
        expect(row.reviewedBy).toBe(OFFICER);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
