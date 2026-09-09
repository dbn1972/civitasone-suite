/**
 * TX-001 (estab-service slice) — files module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep: the files
 * module was the worst offender in estab-service (12 nested call sites,
 * across 10 command handlers, all calling repo.findFileById — a
 * db.transaction()-based read that opens its OWN transaction — from INSIDE
 * an already-open outer db.transaction() in the consumer). Under pool.max
 * concurrent in-flight consumer transactions, every one of them needs a
 * second ("nested") pool connection at the same moment none is free,
 * deadlocking the whole queue silently forever.
 *
 * This test exercises notingAdd (estab.noting.add), which reads the parent
 * file via findFileById to check it isn't closed before inserting the
 * noting — one of the twelve now-fixed sites — at pool.max + 3 concurrency,
 * real Postgres, real pool, many officers adding notes to the SAME file at
 * once (a realistic trigger).
 *
 * Fixed by routing onto repo.findFileByIdTx(tx, ...), reading through the
 * caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f11e0000-dead-4000-8000-00000000f11e";
const OFFICER = "f11e0000-dead-4000-8000-0000000ac70a";
const FILE = "f11e0000-dead-4000-8000-0000000000fe";
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
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.notingAdd, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(estabFiles).values({
        id: FILE, tenantId: TENANT, fileNo: "EST/2026/TX001", subject: "TX-001 deadlock fixture",
        dept: "GAD", priority: "normal", classification: "confidential",
        currentWith: OFFICER, status: "active", createdBy: OFFICER, updatedBy: OFFICER,
      });
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("files consumer notingAdd -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent notingAdd commands on the same file drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerFilesConsumers(q);
      await q.start();

      const notingIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

      await Promise.all(notingIds.map((id, i) =>
        q.publish(COMMANDS.notingAdd, makeMsg(randomUUID(), {
          id, fileId: FILE, tenantId: TENANT,
          body: "Concurrent note " + i, officerId: OFFICER,
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
        db.transaction((tx) => tx.select().from(estabNotings).where(inArray(estabNotings.id, notingIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.fileId).toBe(FILE);
        expect(row.noteStatus).toBe("draft");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
