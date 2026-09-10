/**
 * TX-001 (knowledge-service slice) — versions module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep: the
 * versionRestore handler in versions/consumer.ts calls repo.getById() and
 * repo.getLatestVersionNo() — both db.transaction()-wrapped reads (via
 * scopedRead) that open their OWN pool connection — from INSIDE the
 * already-open outer db.transaction() in the consumer. Under pool.max
 * concurrent in-flight consumer transactions, every one of them needs a
 * second ("nested") pool connection at the same moment none is free,
 * deadlocking the whole queue silently forever.
 *
 * This test exercises versionRestore (knowledge.version.restore) at
 * pool.max + 3 concurrency, real Postgres, real pool, many officers
 * restoring from the SAME source version at once (a realistic trigger --
 * e.g. several editors reverting their own document from a shared template
 * version). Each concurrent command targets its own distinct document so
 * this isolates the pool-deadlock path from an unrelated, pre-existing
 * version-numbering write race (filed separately, see gap report).
 *
 * Fixed by routing onto repo.getByIdTx(tx, ...) and
 * repo.getLatestVersionNoTx(tx, ...), reading through the caller's
 * already-open tx instead of opening a nested one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { documentVersions } from "../src/modules/versions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerVersionsConsumers } from "../src/modules/versions/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7e5510e0-dead-4000-8000-00000000c0de";
const EDITOR = "7e5510e0-dead-4000-8000-0000000ed170";
const SOURCE_DOCUMENT = "7e5510e0-dead-4000-8000-0000000000d0";
const SOURCE_VERSION = "7e5510e0-dead-4000-8000-00000000501c";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the production
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with the
 * tenant-context wrapper. Production wiring (worker.ts) decorates
 * `subscribe()` so every consumer handler runs inside
 * `runWithTenant(msg.tenantId, ...)`, which is what lets `db.transaction()`
 * pick up the tenant GUC. Mirror that here exactly as worker.ts does.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.versionRestore, tenantId: TENANT,
    actorId: EDITOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (keyed only by messageId) and
      // every run uses fresh random messageIds, so it needs no cleanup here.
      await tx.delete(documentVersions).where(eq(documentVersions.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(documentVersions).values({
        id: SOURCE_VERSION, tenantId: TENANT, documentId: SOURCE_DOCUMENT, versionNo: 1,
        s3Key: "knowledge/tx-001-fixture/v1.pdf", sizeBytes: 1024,
        changeNote: "TX-001 deadlock fixture", createdBy: EDITOR, updatedBy: EDITOR,
      });
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("versions consumer versionRestore -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent versionRestore commands from the same source version drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerVersionsConsumers(q);
      await q.start();

      // Each concurrent restore targets its OWN target document (only
      // reading, never writing, the shared source version) so this test
      // isolates the nested-transaction pool-deadlock path from an
      // unrelated, pre-existing "read latest versionNo then +1" write race
      // that surfaces when concurrent restores share a single target
      // document -- see the new gap filed for that (not a TX-001 site: it's
      // a correctness race, not a pool-connection deadlock).
      const restoredIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      const targetDocuments = Array.from({ length: CONCURRENCY }, () => randomUUID());

      await Promise.all(restoredIds.map((id, i) =>
        q.publish(COMMANDS.versionRestore, makeMsg(randomUUID(), {
          id, documentId: targetDocuments[i], versionId: SOURCE_VERSION, tenantId: TENANT,
          changeNote: "Concurrent restore " + i,
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
        db.transaction((tx) => tx.select().from(documentVersions).where(inArray(documentVersions.id, restoredIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(targetDocuments).toContain(row.documentId);
        expect(row.s3Key).toBe("knowledge/tx-001-fixture/v1.pdf");
        expect(row.versionNo).toBe(1);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
