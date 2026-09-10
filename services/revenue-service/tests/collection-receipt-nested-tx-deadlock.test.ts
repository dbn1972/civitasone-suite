/**
 * TX-001 (revenue-service slice) — collection module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep: the
 * evidence column cited only one site (`collection:32`), but a full scan of
 * revenue-service found FOUR nested call sites in collection/consumer.ts —
 * receiptCreate (:32), refundDecide (:166), and BOTH balance reads inside
 * adjustmentCreate (:231 and :262) — each calling repo.getDemandBalance, a
 * tenantTransaction()-based read that opens its OWN transaction, from INSIDE
 * an already-open outer db.transaction() in the consumer. Under pool.max
 * concurrent in-flight consumer transactions, every one of them needs a
 * second ("nested") pool connection at the same moment none is free,
 * deadlocking the whole queue silently forever.
 *
 * This test exercises receiptCreate (revenue.receipt.create), which reads
 * the demand balance via getDemandBalance to validate the receipt amount
 * before writing — the first and simplest of the four now-fixed sites — at
 * pool.max + 3 concurrency, real Postgres, real pool, many cashiers
 * collecting against the SAME demand at once (a realistic trigger: batch
 * counter-collection day, or a BBPS/UPI settlement burst).
 *
 * Fixed by routing onto repo.getDemandBalanceTx(tx, ...), reading through
 * the caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { receipts } from "../src/modules/collection/schema.js";
import { dcbEntries } from "../src/modules/assessment/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "50110000-dead-4000-8000-000000005011";
const ASSESSEE = "50110000-dead-4000-8000-0000000a55ee";
const DEMAND = "50110000-dead-4000-8000-0000000deda1";
const CASHIER = "50110000-dead-4000-8000-00000000ca54";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
// Large enough that every concurrent receiptCreate (100n each) validates
// against the balance snapshot each transaction reads, regardless of read
// ordering -- this test is about the pool deadlock, not the balance race.
const SEEDED_BALANCE = 999_999_999n;
const AMOUNT_PER_RECEIPT = 100n;

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
    messageId: id, type: COMMANDS.receiptCreate, tenantId: TENANT,
    actorId: CASHIER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(receipts).where(eq(receipts.tenantId, TENANT));
      await tx.delete(dcbEntries).where(eq(dcbEntries.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  // Seed the "demand" DCB entry that getDemandBalance()/getDemandBalanceTx()
  // reads (latest entry per demandId, ordered by createdAt).
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(dcbEntries).values({
        id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, demandId: DEMAND,
        entryType: "demand", amountMinor: SEEDED_BALANCE, balanceMinor: SEEDED_BALANCE,
        referenceType: "demand", narration: "TX-001 deadlock fixture", createdBy: CASHIER,
      });
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("collection consumer receiptCreate -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent receiptCreate commands against the same demand drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerCollectionConsumers(q);
      await q.start();

      const receiptRefs = Array.from({ length: CONCURRENCY }, (_, i) => `TX001-RCPT-${i}`);

      await Promise.all(receiptRefs.map((reference, i) =>
        q.publish(COMMANDS.receiptCreate, makeMsg(randomUUID(), {
          assesseeId: ASSESSEE, demandId: DEMAND, amountMinor: AMOUNT_PER_RECEIPT.toString(),
          channel: "counter", reference, instrumentNo: null, bankName: null,
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
        db.transaction((tx) => tx.select().from(receipts).where(inArray(receipts.reference, receiptRefs))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.assesseeId).toBe(ASSESSEE);
        expect(row.demandId).toBe(DEMAND);
        expect(row.amountMinor).toBe(AMOUNT_PER_RECEIPT);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
