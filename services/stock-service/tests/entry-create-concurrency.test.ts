/**
 * CLOS3-S6-02 — the primary entry.create handler did a read-modify-write on
 * stock_valuation_rates with the NON-locking getValuationRateTx. Two entries for the same
 * (item, warehouse) on separate poll loops/instances both read qty=N and one update was lost,
 * leaving on-hand qty / weighted-average rate / ledger balanceQty wrong.
 * The grn.accepted and physical-count handlers already used lockValuationRateTx (GAP2-STOCK-ENTRY-02);
 * entry.create now does too.
 *
 * Real Postgres, real pool. A barrier between the valuation read and the upsert forces the
 * interleave: both handlers read before either writes (what happens without the lock). With the lock
 * the 2nd handler is blocked until the 1st commits, the barrier times out for the 1st, and the
 * sequential result is produced.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { stockReceipts } from "../src/modules/receipt/schema.js";
import { stockEntries, stockEntryItems } from "../src/modules/entry/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import * as repo from "../src/modules/entry/repo.js";
import * as receiptRepo from "../src/modules/receipt/repo.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "a9b9c900-0000-4000-8000-00000000e201";
const OFFICER = "a9b9c900-0000-4000-8000-00000000e20f";
const WAREHOUSE = "a9b9c900-0000-4000-8000-00000000e2fb";

type Handler = (msg: unknown) => Promise<void>;

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = {
    subscribe: (topic: string, h: (m: { tenantId: string }) => Promise<void>) => {
      handlers.set(topic, (m) => runWithTenant((m as { tenantId: string }).tenantId, () => h(m as { tenantId: string })));
    },
  } as unknown as Queue;
  registerEntryConsumers(fake);
  return handlers;
}

/** Barrier between the valuation read and the upsert; releases on `parties` arrivals or after 750ms. */
function installBarrier(parties = 2) {
  const original = repo.upsertValuationRate;
  let arrived = 0;
  let releasedByArrival = false;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.spyOn(repo, "upsertValuationRate").mockImplementation(async (...args) => {
    arrived += 1;
    if (arrived >= parties) { releasedByArrival = true; release(); }
    await Promise.race([gate, new Promise<void>((r) => setTimeout(r, 750))]);
    return original(...args);
  });
  return { releasedByArrival: () => releasedByArrival };
}

const msg = (entryType: "receipt" | "issue", itemId: string, qty: number, rateMinor: number) => ({
  messageId: randomUUID(), type: COMMANDS.entryCreate, tenantId: TENANT,
  actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
  payload: {
    id: randomUUID(), tenantId: TENANT, entryType, postingDate: "2026-09-10",
    ...(entryType === "receipt" ? { toWarehouseId: WAREHOUSE } : { fromWarehouseId: WAREHOUSE }),
    items: [{ itemId, qty, rateMinor }],
  },
});

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
    await tx.delete(stockEntryItems).where(eq(stockEntryItems.tenantId, TENANT));
    await tx.delete(stockEntries).where(eq(stockEntries.tenantId, TENANT));
    await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, TENANT));
    await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, TENANT));
  }));
}

/** Seed on-hand qty (valuation row + one FIFO batch so issues can be served). */
async function seed(itemId: string, qty: number, rateMinor: bigint) {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await repo.upsertValuationRate(tx, TENANT, itemId, WAREHOUSE, qty, rateMinor, "INR");
    await receiptRepo.insertReceipt(tx, {
      id: randomUUID(), tenantId: TENANT, itemId, warehouseId: WAREHOUSE, entryId: randomUUID(),
      quantity: qty, remainingQty: qty, unitCostMinor: rateMinor, currency: "INR",
    });
  }));
}

const valuation = (itemId: string) => runWithTenant(TENANT, () => db.transaction((tx) =>
  tx.select().from(stockValuationRates).where(and(
    eq(stockValuationRates.tenantId, TENANT), eq(stockValuationRates.itemId, itemId),
    eq(stockValuationRates.warehouseId, WAREHOUSE)))));
const ledger = (itemId: string) => runWithTenant(TENANT, () => db.transaction((tx) =>
  tx.select().from(stockLedger).where(and(eq(stockLedger.tenantId, TENANT), eq(stockLedger.itemId, itemId)))));

beforeEach(async () => { await clean(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("entry.create — concurrent valuation read-modify-write (CLOS3-S6-02)", () => {
  it("two concurrent receipts (5 and 7) onto qty=10 end at 22 with a weighted-average rate", async () => {
    const itemId = randomUUID();
    await seed(itemId, 10, 1000n);
    const create = captureHandlers().get(COMMANDS.entryCreate)!;
    installBarrier();

    await Promise.all([create(msg("receipt", itemId, 5, 2000)), create(msg("receipt", itemId, 7, 2000))]);

    const [row] = await valuation(itemId);
    expect(row.qty).toBe(22);
    // sequential WAVG: (10*1000 + 5*2000)/15 = 1333 ; (15*1333 + 7*2000)/22 = 1545 (integer maths in weightedAvgRate)
    const seqRate = row.rateMinor;
    expect(seqRate > 1333n && seqRate < 2000n).toBe(true);
    const balances = (await ledger(itemId)).map((l) => l.balanceQty).sort((a, b) => a - b);
    expect(balances[1]).toBe(22);
    expect([15, 17]).toContain(balances[0]);
  }, 20_000);

  it("receipt (5) racing an issue (3) onto qty=10 ends at 12", async () => {
    const itemId = randomUUID();
    await seed(itemId, 10, 1000n);
    const create = captureHandlers().get(COMMANDS.entryCreate)!;
    installBarrier();

    await Promise.all([create(msg("receipt", itemId, 5, 1000)), create(msg("issue", itemId, 3, 0))]);

    const [row] = await valuation(itemId);
    expect(row.qty).toBe(12);
    const balances = (await ledger(itemId)).map((l) => l.balanceQty).sort((a, b) => a - b);
    expect(balances[1] === 12 || balances[1] === 15).toBe(true);
    expect(balances).toContain(12);
  }, 20_000);

  it("entries for DIFFERENT items are not serialized against each other", async () => {
    const a = randomUUID(); const b = randomUUID();
    await seed(a, 10, 1000n); await seed(b, 10, 1000n);
    const create = captureHandlers().get(COMMANDS.entryCreate)!;
    const barrier = installBarrier();

    await Promise.all([create(msg("receipt", a, 5, 1000)), create(msg("receipt", b, 7, 1000))]);

    // both reached the barrier together (not blocked on each other's lock)
    expect(barrier.releasedByArrival()).toBe(true);
    expect((await valuation(a))[0].qty).toBe(15);
    expect((await valuation(b))[0].qty).toBe(17);
  }, 20_000);
});
