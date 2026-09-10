/**
 * TX-016 — knowledge-service versions module, non-atomic version-number
 * allocation race.
 *
 * Found verifying TX-001's knowledge-service fix (PR #1141): versionRestore
 * (and equally versionCreate) computes
 *   nextVersionNo = getLatestVersionNo(documentId) + 1
 * then inserts. Two concurrent commands for the SAME document can both read
 * the same latest versionNo before either inserts, so both try to write the
 * identical (tenant_id, document_id, version_no) tuple. The
 * document_versions_doc_version_uk unique index correctly rejects the
 * second insert -- but that failure throws inside the consumer's
 * db.transaction(), which the outer MemoryQueue delivery swallows into the
 * DLQ. The command is not retried: one restore silently disappears instead
 * of getting a distinct version number.
 *
 * This is explicitly NOT the TX-001 pool-deadlock pattern (getLatestVersionNo
 * is already routed through the Tx sibling, so there is no nested
 * transaction/second pool connection here) -- it is a correctness race
 * inside a single, already well-scoped transaction. Unlike TX-001's test,
 * every concurrent command here targets the SAME document on purpose: that
 * shared target is exactly what makes the version-number race possible.
 *
 * Fixed by repo.lockVersionSeq(tx, tenantId, documentId): a
 * pg_advisory_xact_lock keyed on (tenantId, documentId), taken inside the
 * transaction before getLatestVersionNoTx(), so concurrent allocations for
 * the same document serialize instead of racing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { documentVersions } from "../src/modules/versions/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerVersionsConsumers } from "../src/modules/versions/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7e5510e0-dead-4000-8000-0000000016a0";
const EDITOR = "7e5510e0-dead-4000-8000-000000016ed1";
const TARGET_DOCUMENT = "7e5510e0-dead-4000-8000-0000000016d0";
const SOURCE_VERSION = "7e5510e0-dead-4000-8000-000000016501";
// High enough that a read-then-insert race is very likely to fire on real
// Postgres (all commands overlap on the SAME document, unlike TX-001's
// test which spreads concurrency across distinct documents).
const CONCURRENCY = 15;

/**
 * Mirrors worker.ts's tenant-context wrapper -- see versions-nested-tx-
 * deadlock.test.ts for why this is required with a bare `new MemoryQueue()`.
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
      await tx.delete(documentVersions).where(eq(documentVersions.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  // Seed the ONE existing version every concurrent restore will target --
  // both as the restore source and as the document whose "latest" number
  // every concurrent command races to increment.
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(documentVersions).values({
        id: SOURCE_VERSION, tenantId: TENANT, documentId: TARGET_DOCUMENT, versionNo: 1,
        s3Key: "knowledge/tx-016-fixture/v1.pdf", sizeBytes: 512,
        changeNote: "TX-016 race fixture", createdBy: EDITOR, updatedBy: EDITOR,
      });
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("versions consumer versionRestore -- version-number allocation race (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent versionRestore commands on the SAME document yield " + CONCURRENCY +
      " distinct, contiguous version numbers and an empty DLQ",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerVersionsConsumers(q);
      await q.start();

      const restoredIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

      await Promise.all(restoredIds.map((id, i) =>
        q.publish(COMMANDS.versionRestore, makeMsg(randomUUID(), {
          id, documentId: TARGET_DOCUMENT, versionId: SOURCE_VERSION, tenantId: TENANT,
          changeNote: "Concurrent restore " + i,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 15_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms").toBe(false);
      // The regression this guards against: a losing insert (duplicate-key
      // violation on document_versions_doc_version_uk) throws inside the
      // handler's db.transaction() and MemoryQueue.deliver() swallows that
      // into q.dlq rather than rejecting -- so an empty DLQ is exactly the
      // "no command silently lost the race" assertion.
      expect((q as MemoryQueue).dlq, "commands were lost to the version-number race: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(documentVersions).where(eq(documentVersions.documentId, TARGET_DOCUMENT))),
      );

      // 1 seed row + CONCURRENCY restores.
      expect(rows).toHaveLength(CONCURRENCY + 1);

      const restoredRows = rows.filter((r) => restoredIds.includes(r.id));
      expect(restoredRows).toHaveLength(CONCURRENCY);

      const versionNos = restoredRows.map((r) => r.versionNo);
      const distinctVersionNos = new Set(versionNos);
      expect(distinctVersionNos.size, "duplicate version numbers were assigned: " + JSON.stringify(versionNos.sort((a, b) => a - b))).toBe(CONCURRENCY);

      // Not just distinct -- contiguous 2..CONCURRENCY+1, proving no number
      // was skipped (which would indicate a lost/rolled-back insert whose
      // failure went unnoticed) and none reused the seed's versionNo 1.
      const expected = Array.from({ length: CONCURRENCY }, (_, i) => i + 2).sort((a, b) => a - b);
      expect(versionNos.sort((a, b) => a - b)).toEqual(expected);

      await q.stop();
    },
    { timeout: 25_000 },
  );
});
