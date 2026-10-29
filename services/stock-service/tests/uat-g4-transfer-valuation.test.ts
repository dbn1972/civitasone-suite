/**
 * UAT DB sweep 2026-10-28 (g4) — stock transfer valuation.
 * A transfer of 20 units @5000 wh1 -> wh2 left the destination valuation rate at 0 (the consumer
 * kept the destination's existing rate, 0 for a first-time destination) and the transfer_in ledger
 * row carried that wrong rate. The destination must be valued at the SOURCE warehouse rate,
 * weighted-averaged with any stock already there. Real Postgres + RLS.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
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

const TENANT = "a9b9c900-0000-4000-8000-00000000f601";
const OFFICER = "a9b9c900-0000-4000-8000-00000000f60f";
const WH1 = "a9b9c900-0000-4000-8000-00000000f6a1";
const WH2 = "a9b9c900-0000-4000-8000-00000000f6a2";

type Handler = (msg: unknown) => Promise<void>;
function createHandler(): Handler {
  let h!: Handler;
  const fake = {
    subscribe: (topic: string, fn: (m: { tenantId: string }) => Promise<void>) => {
      if (topic === COMMANDS.entryCreate) h = (m) => runWithTenant((m as { tenantId: string }).tenantId, () => fn(m as { tenantId: string }));
    },
  } as unknown as Queue;
  registerEntryConsumers(fake);
  return h;
}

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

async function seed(itemId: string, warehouseId: string, qty: number, rateMinor: bigint) {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await repo.upsertValuationRate(tx, TENANT, itemId, warehouseId, qty, rateMinor, "INR");
    await receiptRepo.insertReceipt(tx, {
      id: randomUUID(), tenantId: TENANT, itemId, warehouseId, entryId: randomUUID(),
      quantity: qty, remainingQty: qty, unitCostMinor: rateMinor, currency: "INR",
    });
  }));
}

const valuation = (itemId: string, warehouseId: string) => runWithTenant(TENANT, () => db.transaction(async (tx) => {
  const r = await tx.select().from(stockValuationRates).where(and(
    eq(stockValuationRates.tenantId, TENANT), eq(stockValuationRates.itemId, itemId), eq(stockValuationRates.warehouseId, warehouseId)));
  return r[0];
}));
const ledger = (itemId: string) => runWithTenant(TENANT, () => db.transaction((tx) =>
  tx.select().from(stockLedger).where(and(eq(stockLedger.tenantId, TENANT), eq(stockLedger.itemId, itemId)))));

const transfer = (itemId: string, qty: number, rateMinor: number) => ({
  messageId: randomUUID(), type: COMMANDS.entryCreate, tenantId: TENANT,
  actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
  payload: {
    id: randomUUID(), tenantId: TENANT, entryType: "transfer", postingDate: "2026-10-28",
    fromWarehouseId: WH1, toWarehouseId: WH2, items: [{ itemId, qty, rateMinor }],
  },
});

beforeEach(async () => { await clean(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("stock transfer carries the source valuation rate to the destination", () => {
  it("first-time destination: 20 @ 5000 -> destination qty 20, rate 5000, transfer_in ledger rate 5000", async () => {
    const itemId = randomUUID();
    await seed(itemId, WH1, 50, 5000n);
    await createHandler()(transfer(itemId, 20, 5000));

    const dest = await valuation(itemId, WH2);
    expect(dest?.qty).toBe(20);
    expect(dest?.rateMinor).toBe(5000n);
    expect((await valuation(itemId, WH1))?.qty).toBe(30);
    const tin = (await ledger(itemId)).find((l) => l.voucherType === "transfer_in");
    expect(tin?.rateMinor).toBe(5000n);
  });

  it("uses the SOURCE rate, not the caller-supplied rate, and weighted-averages with existing destination stock", async () => {
    const itemId = randomUUID();
    await seed(itemId, WH1, 50, 6000n);
    await seed(itemId, WH2, 10, 3000n);
    await createHandler()(transfer(itemId, 20, 1)); // caller rate is ignored for valuation

    // (10*3000 + 20*6000) / 30 = 5000
    expect((await valuation(itemId, WH2))?.rateMinor).toBe(5000n);
    expect((await valuation(itemId, WH2))?.qty).toBe(30);
  });
});
