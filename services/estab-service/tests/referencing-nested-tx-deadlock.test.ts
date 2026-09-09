/**
 * TX-001 (estab-service slice) — referencing module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep:
 * referencing's referenceRemove consumer called repo.findReferenceById --
 * a db.transaction()-based read that opens its OWN transaction -- from
 * INSIDE an already-open outer db.transaction(). Under pool.max concurrent
 * in-flight consumer transactions, every one of them needs a second
 * ("nested") pool connection at the same moment none is free, deadlocking
 * the whole queue silently forever.
 *
 * This test exercises referenceRemove (estab.reference.remove) at
 * pool.max + 3 concurrency, real Postgres, real pool, each command removing
 * a distinct reference row (avoiding row-lock serialization so the test
 * isolates the pool-connection deadlock specifically).
 *
 * Fixed by routing onto repo.findReferenceByIdTx(tx, ...), reading through
 * the caller's already-open tx.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabReference } from "../src/modules/referencing/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerReferencingConsumers } from "../src/modules/referencing/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "aef00000-dead-4000-8000-0000000000f1";
const OFFICER = "aef00000-dead-4000-8000-0000000ac70a";
const FILE = "aef00000-dead-4000-8000-0000000000fe";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.referenceRemove, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabReference).where(eq(estabReference.tenantId, TENANT));
    }),
  );
}

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("referencing consumer referenceRemove -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent referenceRemove commands (one distinct reference each) drain without deadlocking the connection pool",
    async () => {
      await clean();
      const refIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      await runWithTenant(TENANT, () =>
        db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            await tx.insert(estabReference).values({
              id: refIds[i], tenantId: TENANT, fileId: FILE,
              refType: "cross_file", refValue: "CIR/2026/TX001-" + i,
              createdBy: OFFICER,
            });
          }
        }),
      );

      const q = wireTenantAwareQueue(new MemoryQueue());
      registerReferencingConsumers(q);
      await q.start();

      await Promise.all(refIds.map((id) =>
        q.publish(COMMANDS.referenceRemove, makeMsg(randomUUID(), {
          referenceId: id, tenantId: TENANT,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(estabReference).where(inArray(estabReference.id, refIds))),
      );
      expect(rows, "all references should have been deleted -- a stale/partial row means the remove silently no-op'd instead of genuinely deleting").toHaveLength(0);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
