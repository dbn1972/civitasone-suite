/**
 * TX-001 (stock-service slice) -- entry module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `stock 1 loop (entry:71,95)`, confirmed by an independent
 * manual scan of every db.transaction() block in this service -- exactly 2
 * genuine sites, both in entry/consumer.ts's entryCreate handler's per-item
 * loop, matching the evidence column exactly):
 *
 *   1. `repo.getValuationRate(p.tenantId, item.itemId, dest)` (was line 71,
 *      destination-warehouse branch: receipt / adjustment / transfer-in)
 *   2. `repo.getValuationRate(p.tenantId, item.itemId, src)`  (was line 95,
 *      source-warehouse branch: issue / transfer-out)
 *
 * getValuationRate() is defined via this service's `scopedRead()` helper
 * (src/shared/db.ts), which is a bare `db.transaction(fn)` -- i.e. this bare
 * read repo function already opens its OWN transaction, same failure shape
 * as parking/estab/procurement's TX-001 fixes. Called from INSIDE
 * entryCreate's already-open outer db.transaction(), each of these needs a
 * second, nested pool connection. Under pool.max concurrent in-flight
 * consumer transactions, no second connection is ever free and the whole
 * queue deadlocks silently forever. Both sites are fixed identically, by
 * routing the read onto repo.getValuationRateTx(tx, ...) instead.
 *
 * SCOPE NOTE -- why this test only drives site 1 (dest branch) live:
 * Site 2 (src branch, was line 95) is reached only when entryType is
 * "issue" or "transfer" (consumer.ts's `needsStockCheck` gate). That same
 * gate unconditionally calls `receiptRepo.lockAvailableQty()` first --
 * which turns out to be its own, pre-existing, completely unrelated bug:
 * `ANY(${lockedIds}::uuid[])` interpolates a plain JS array into drizzle's
 * `sql` template tag, which postgres.js binds as a single scalar parameter
 * rather than a Postgres array literal, so the query throws
 * `PostgresError: malformed array literal` (22P02) on its very first row,
 * every time -- confirmed by an isolated repro (db.transaction(tx =>
 * receiptRepo.lockAvailableQty(tx, ...)) against a freshly seeded receipt
 * row, same crash). This means EVERY "issue"/"transfer" stock entry fails
 * in production today, independent of load and independent of TX-001,
 * making the src-branch nested-tx call site (fixed identically to the dest
 * branch below, same function, same Writer/tx typing, verified by code
 * review + a clean `tsc --noEmit`) unreachable through the real consumer
 * until that bug is fixed. Filed separately as DOM-021 (not fixed here --
 * out of TX-001's scope, per the campaign rule against silently fixing
 * unrelated bugs inline). This test therefore drives "receipt" entries,
 * which only exercise the dest-branch call site (no stock-check gate), at
 * pool.max + 3 concurrency to prove that site's fix under real contention.
 *
 * This test drives entryCreate (stock.entry.create, entryType: "receipt")
 * at pool.max + 3 concurrency, real Postgres, real pool, many different
 * items received into the same warehouse at once (a realistic trigger --
 * e.g. a bulk GRN-driven receipt batch). Fixed by routing the read onto
 * repo.getValuationRateTx(tx, ...), reading through the caller's
 * already-open tx instead of opening a second one.
 *
 * Sabotage check (see PR body): reverting the dest-branch call site back to
 * the bare repo.getValuationRate() reproduces the drain timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, and } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { stockEntries, stockEntryItems } from "../src/modules/entry/schema.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { stockReceipts } from "../src/modules/receipt/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT   = "9c1c1000-dead-4000-8000-0000009c1c10";
const OFFICER  = "9c1c1000-dead-4000-8000-0000009c1c0f";
const WAREHOUSE = "9c1c1000-dead-4000-8000-0000009c1cfb";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly this test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const RECEIPT_QTY = 5;
const RATE_MINOR = 1000n;

let itemIds: string[] = [];

/**
 * production wraps every consumer's handler in runWithTenant(msg.tenantId,
 * ...) at the queue level (services/stock-service/src/worker.ts) -- the
 * per-module registerXConsumers() functions (entry's included) do not do
 * this themselves. Replicate that exact wrapping so this test exercises the
 * real production call shape, not a hand-rolled shortcut.
 */
function tenantWrapped(queue: Queue): Queue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return queue;
}

function makeMsg(entryId: string, itemId: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.entryCreate, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: entryId, tenantId: TENANT, entryType: "receipt",
      postingDate: "2026-09-10",
      toWarehouseId: WAREHOUSE,
      items: [{ itemId, qty: RECEIPT_QTY, rateMinor: Number(RATE_MINOR) }],
    },
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (just messageId + processedAt,
      // see packages/outbox/src/index.ts) -- messageIds here are always fresh
      // randomUUID()s per test run, so there is nothing of this tenant's to
      // clean there (same as parking-service's TX-001 deadlock test precedent).
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
      await tx.delete(stockEntryItems).where(eq(stockEntryItems.tenantId, TENANT));
      await tx.delete(stockEntries).where(eq(stockEntries.tenantId, TENANT));
      await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, TENANT));
      await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  itemIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("entry consumer entryCreate(receipt) -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent entryCreate(receipt) commands across different items into the same warehouse drain without deadlocking the connection pool`,
    async () => {
      const q = tenantWrapped(new MemoryQueue());
      registerEntryConsumers(q);
      await q.start();

      const entryIds = itemIds.map(() => randomUUID());
      await Promise.all(
        itemIds.map((itemId, i) => q.publish(COMMANDS.entryCreate, makeMsg(entryIds[i], itemId))),
      );

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      await q.stop();

      const entries = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(stockEntries).where(inArray(stockEntries.id, entryIds))),
      );
      expect(entries).toHaveLength(CONCURRENCY);
      for (const row of entries) {
        expect(row.status, `entry ${row.id} did not post`).toBe("posted");
      }

      // Every concurrent handler must have landed its nested read correctly
      // (not just avoided the deadlock) -- prove it via the actual valuation
      // math for every item (no prior valuation row existed, so
      // getValuationRateTx must have returned qty:0 for the weighted-average
      // to compute correctly, not a stale/wrong read from a raced tx).
      const rates = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(stockValuationRates)
          .where(and(eq(stockValuationRates.tenantId, TENANT), eq(stockValuationRates.warehouseId, WAREHOUSE)))),
      );
      expect(rates).toHaveLength(CONCURRENCY);
      for (const row of rates) {
        expect(row.qty, `valuation for item ${row.itemId} was not incremented correctly`).toBe(RECEIPT_QTY);
        expect(row.rateMinor, `valuation rate for item ${row.itemId} was not set correctly`).toBe(RATE_MINOR);
      }

      const ledgerRows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(stockLedger).where(eq(stockLedger.tenantId, TENANT))),
      );
      // One "receipt" ledger row per item.
      expect(ledgerRows).toHaveLength(CONCURRENCY);
    },
    { timeout: 20_000 },
  );
});
