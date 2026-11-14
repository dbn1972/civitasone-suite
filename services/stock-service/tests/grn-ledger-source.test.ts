/**
 * The stock-service GRN consumer skips (ack, no rows) for tenants on the inventory ledger, writes for
 * stock-ledger tenants, and writes (with a warning) when the setting cannot be read. Real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { stockReceipts } from "../src/modules/receipt/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import { CONSUMED } from "../src/topics.js";
import { isInventoryLedger, clearLedgerSourceCache } from "../src/shared/ledger-source.js";

const T_INV = "9c1c3000-dead-4000-8000-0000009c3c01";
const T_STOCK = "9c1c3000-dead-4000-8000-0000009c3c02";
const T_DOWN = "9c1c3000-dead-4000-8000-0000009c3c03";
const OFFICER = "9c1c3000-dead-4000-8000-0000009c3c0f";
const WAREHOUSE = "9c1c3000-dead-4000-8000-0000009c3cfb";

function tenantWrapped(queue: Queue): Queue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const raw = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return queue;
}

const rows = (t: string) => runWithTenant(t, () => db.transaction(async (tx) => ({
  ledger: await tx.select().from(stockLedger).where(eq(stockLedger.tenantId, t)),
  receipts: await tx.select().from(stockReceipts).where(eq(stockReceipts.tenantId, t)),
  valuation: await tx.select().from(stockValuationRates).where(eq(stockValuationRates.tenantId, t)),
})));
async function clean() {
  for (const t of [T_INV, T_STOCK, T_DOWN]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, t));
      await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, t));
      await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, t));
    }));
  }
}

let q: MemoryQueue;
beforeAll(async () => {
  await clean();
  q = tenantWrapped(new MemoryQueue()) as unknown as MemoryQueue;
  registerEntryConsumers(q as unknown as Queue);
  await q.start();
});
afterAll(async () => { await q.stop(); await clean(); await sqlClient.end(); });
beforeEach(() => clearLedgerSourceCache());
afterEach(() => vi.unstubAllGlobals());

const grn = (tenantId: string) => ({
  messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId, actorId: OFFICER,
  correlationId: randomUUID(), schemaVersion: "1.0",
  payload: { grnId: randomUUID(), poRef: "PO-1", vendorId: randomUUID(), warehouseId: WAREHOUSE,
    items: [{ itemCode: "IC-1", itemName: "Pen", itemId: randomUUID(), acceptedQty: 4, rateMinor: 250 }] },
});
const answer = (ledgerSource: string, status = 200) => vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
  expect(String(url)).toContain("/v1/inventory/ledger-source");
  expect(init.headers["x-internal"]).toBe("1");
  return new Response(JSON.stringify({ data: { ledgerSource } }), { status });
});

describe("GRN accepted vs the tenant's ledger source", () => {
  it("inventory ledger: acked, no stock rows, not dead-lettered", async () => {
    const f = answer("inventory");
    vi.stubGlobal("fetch", f);
    await q.publish(CONSUMED.grnAccepted, grn(T_INV));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    const r = await rows(T_INV);
    expect([r.ledger.length, r.receipts.length, r.valuation.length]).toEqual([0, 0, 0]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("stock ledger: the receipt is written as before", async () => {
    vi.stubGlobal("fetch", answer("stock"));
    await q.publish(CONSUMED.grnAccepted, grn(T_STOCK));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    const r = await rows(T_STOCK);
    expect([r.ledger.length, r.receipts.length, r.valuation.length]).toEqual([1, 1, 1]);
  });

  it("unreadable setting (5xx / network error): the receipt is still written, never dropped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await q.publish(CONSUMED.grnAccepted, grn(T_DOWN));
    await q.drain();
    expect((await rows(T_DOWN)).ledger).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    clearLedgerSourceCache();
    await q.publish(CONSUMED.grnAccepted, grn(T_DOWN));
    await q.drain();
    expect((await rows(T_DOWN)).ledger).toHaveLength(2);
    expect(q.dlq).toHaveLength(0);
  });
});

describe("isInventoryLedger", () => {
  it("warns when the setting cannot be read, and answers false", async () => {
    const warn = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    expect(await isInventoryLedger("t-warn", warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![1])).toMatch(/unreadable/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ledgerSource: "weird" } }), { status: 200 })));
    expect(await isInventoryLedger("t-warn2", warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("caches a clean answer briefly, and does not cache a failure", async () => {
    const f = answer("inventory");
    vi.stubGlobal("fetch", f);
    expect(await isInventoryLedger("t-cache")).toBe(true);
    expect(await isInventoryLedger("t-cache")).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const bad = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", bad);
    await isInventoryLedger("t-nocache", () => undefined);
    await isInventoryLedger("t-nocache", () => undefined);
    expect(bad).toHaveBeenCalledTimes(2);
  });
});
