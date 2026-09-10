/**
 * DOM-021 -- receiptRepo.lockAvailableQty() crashed on every call, so
 * stock "issue"/"transfer" entries always failed.
 *
 * Root cause (services/stock-service/src/modules/receipt/repo.ts, was
 * lines 28-33): the availability-sum step built
 * `WHERE id = ANY(${lockedIds}::uuid[])` inside drizzle's raw `sql`
 * template tag. postgres.js binds a plain JS array interpolated that way
 * as a single scalar parameter, not a Postgres array literal, so the
 * query threw `PostgresError: malformed array literal` (22P02) as soon as
 * any matching receipt row existed to lock -- i.e. on every real
 * issue/transfer entry once a warehouse actually had FIFO stock.
 * `entry/consumer.ts`'s entryCreate handler calls lockAvailableQty()
 * unconditionally for entryType "issue"/"transfer" (the needsStockCheck
 * gate) before doing anything else, so 100% of issue/transfer stock
 * entries failed in production, independent of load.
 *
 * Fixed by replacing the raw ANY(...) interpolation with drizzle's
 * inArray() query-builder helper, which parameterizes the id list
 * correctly instead of relying on manual array-literal interpolation.
 *
 * This is this gap's own DoD: post a real stock.entry.create with
 * entryType "issue" and one with "transfer" against a warehouse with
 * FIFO receipt stock, and assert both succeed.
 *
 * Sabotage check (see PR body): reverting repo.ts's Step 2 back to the
 * raw `ANY(${lockedIds}::uuid[])` sql template reproduces the crash --
 * both entries below land in the queue's DLQ with a "malformed array
 * literal" PostgresError instead of posting.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
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

const TENANT      = "d0421000-dead-4000-8000-0000000d0421";
const OFFICER     = "d0421000-dead-4000-8000-0000000d042f";
const WAREHOUSE_A = "d0421000-dead-4000-8000-0000000d04a1";
const WAREHOUSE_B = "d0421000-dead-4000-8000-0000000d04b2";
const RECEIPT_QTY = 10;
const ISSUE_QTY = 4;
const TRANSFER_QTY = 3;
const RATE_MINOR = 500;

/**
 * production wraps every consumer's handler in runWithTenant(msg.tenantId,
 * ...) at the queue level (services/stock-service/src/worker.ts) -- the
 * per-module registerXConsumers() functions do not do this themselves.
 * Replicate that exact wrapping so this test exercises the real
 * production call shape (same precedent as the TX-001 stock-service test).
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

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.entryCreate, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
      await tx.delete(stockEntryItems).where(eq(stockEntryItems.tenantId, TENANT));
      await tx.delete(stockEntries).where(eq(stockEntries.tenantId, TENANT));
      await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, TENANT));
      await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => { await clean(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("entry consumer entryCreate(issue/transfer) -- DOM-021 lockAvailableQty() array-literal regression (real DB, no mocks)", () => {
  it("issue and transfer entries against a warehouse with FIFO receipt stock both post successfully", async () => {
    const q = tenantWrapped(new MemoryQueue());
    registerEntryConsumers(q);
    await q.start();

    const itemId = randomUUID();

    // 1. Seed FIFO receipt stock into WAREHOUSE_A via a real "receipt" entry.
    const receiptEntryId = randomUUID();
    await q.publish(COMMANDS.entryCreate, makeMsg({
      id: receiptEntryId, tenantId: TENANT, entryType: "receipt",
      postingDate: "2026-09-10", toWarehouseId: WAREHOUSE_A,
      items: [{ itemId, qty: RECEIPT_QTY, rateMinor: RATE_MINOR }],
    }));

    // 2. Issue out of WAREHOUSE_A -- this is the entryType that was
    //    crashing 100% of the time before the fix (needsStockCheck gate
    //    calls the buggy lockAvailableQty() before anything else runs).
    const issueEntryId = randomUUID();
    await q.publish(COMMANDS.entryCreate, makeMsg({
      id: issueEntryId, tenantId: TENANT, entryType: "issue",
      postingDate: "2026-09-10", fromWarehouseId: WAREHOUSE_A,
      items: [{ itemId, qty: ISSUE_QTY, rateMinor: RATE_MINOR }],
    }));

    // 3. Transfer WAREHOUSE_A -> WAREHOUSE_B -- same buggy gate, other branch.
    const transferEntryId = randomUUID();
    await q.publish(COMMANDS.entryCreate, makeMsg({
      id: transferEntryId, tenantId: TENANT, entryType: "transfer",
      postingDate: "2026-09-10",
      fromWarehouseId: WAREHOUSE_A, toWarehouseId: WAREHOUSE_B,
      items: [{ itemId, qty: TRANSFER_QTY, rateMinor: RATE_MINOR }],
    }));

    await q.drain();

    // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
    // rejecting -- assert the DLQ is empty so a "malformed array literal"
    // crash on the issue/transfer entries isn't masked by a "drained" queue.
    expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
    await q.stop();

    const entries = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(stockEntries).where(eq(stockEntries.tenantId, TENANT))),
    );
    expect(entries).toHaveLength(3);
    const byId = new Map(entries.map((e) => [e.id, e]));

    expect(byId.get(receiptEntryId)?.status, "seed receipt entry did not post").toBe("posted");
    expect(byId.get(issueEntryId)?.status, "issue entry did not post -- lockAvailableQty() regressed").toBe("posted");
    expect(byId.get(transferEntryId)?.status, "transfer entry did not post -- lockAvailableQty() regressed").toBe("posted");

    // Prove the FIFO consumption actually happened correctly, not just
    // that the entries landed with status "posted": remaining_qty on the
    // receipt row must reflect both draws (10 - 4 - 3 = 3).
    const receiptRows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(stockReceipts).where(
        and(eq(stockReceipts.tenantId, TENANT), eq(stockReceipts.warehouseId, WAREHOUSE_A)),
      )),
    );
    expect(receiptRows).toHaveLength(1);
    expect(receiptRows[0].remainingQty, "FIFO remaining_qty was not decremented correctly").toBe(RECEIPT_QTY - ISSUE_QTY - TRANSFER_QTY);
  });
});
