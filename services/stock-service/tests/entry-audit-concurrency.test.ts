/**
 * GAP2-STOCK-ENTRY-01 / GAP2-STOCK-ENTRY-02 — stock entry consumer audit +
 * concurrency.
 *
 * ENTRY-01: the grn.accepted and physical.verification.create handlers post
 * financial stock mutations (ledger rows, valuation rates, FIFO receipts) and
 * MUST emit an audit event in the same transaction. On the old code they
 * emitted none.
 *
 * ENTRY-02: grn.accepted weighted-average revaluation is a read-modify-write.
 * The read is now inside the transaction under a row lock, so two concurrent
 * grn.accepted messages for the same item/warehouse must leave qty = sum of
 * both accepted quantities (no lost update). On the old code the read happened
 * outside the tx with no lock and could interleave.
 *
 * Real Postgres, real pool, in-memory queue (production tenant wrapping).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { stockReceipts } from "../src/modules/receipt/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import { COMMANDS, CONSUMED } from "../src/topics.js";

const TENANT    = "a9b9c900-0000-4000-8000-00000000e101";
const OFFICER   = "a9b9c900-0000-4000-8000-00000000e10f";
const WAREHOUSE = "a9b9c900-0000-4000-8000-00000000e1fb";

/** Replicate the worker's per-message runWithTenant wrapping. */
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

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
    await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, TENANT));
    await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, TENANT));
  }));
}

/** Read audit events captured in the outbox for this tenant. */
async function auditEvents(resourceType: string): Promise<Array<{ action: string; resourceType: string }>> {
  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
  return rows
    .map((r) => (r.payload ?? {}) as { action?: string; resourceType?: string })
    .filter((p) => p.resourceType === resourceType)
    .map((p) => ({ action: p.action ?? "", resourceType: p.resourceType ?? "" }));
}

beforeAll(async () => { await clean(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("stock entry consumer — audit + concurrency", () => {
  it("GAP2-STOCK-ENTRY-01: grn.accepted emits an audit event for the stock receipt", async () => {
    await clean();
    const q = tenantWrapped(new MemoryQueue());
    registerEntryConsumers(q);
    await q.start();

    const itemId = randomUUID();
    await q.publish(CONSUMED.grnAccepted, {
      messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: TENANT,
      actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        grnId: randomUUID(), poRef: "PO-1", vendorId: randomUUID(),
        warehouseId: WAREHOUSE,
        items: [{ itemCode: "IC-1", itemName: "Bolt", acceptedQty: 7, rateMinor: 1000, itemId }],
      },
    });
    await q.drain();
    await q.stop();

    const events = await auditEvents("stock_receipt");
    expect(events.some((e) => e.action === "create")).toBe(true);
  });

  it("GAP2-STOCK-ENTRY-01: physical.verification.create emits an audit event for the adjustment", async () => {
    await clean();
    const q = tenantWrapped(new MemoryQueue());
    registerEntryConsumers(q);
    await q.start();

    const itemId = randomUUID();
    await q.publish(COMMANDS.physicalCreate, {
      messageId: randomUUID(), type: COMMANDS.physicalCreate, tenantId: TENANT,
      actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: randomUUID(), tenantId: TENANT, warehouseId: WAREHOUSE,
        postingDate: "2026-09-10",
        items: [{ itemId, countedQty: 12 }],
      },
    });
    await q.drain();
    await q.stop();

    const events = await auditEvents("stock_entry");
    expect(events.some((e) => e.action === "adjust")).toBe(true);
  });

  it("GAP2-STOCK-ENTRY-02: concurrent grn.accepted for the same item sum quantities (no lost update)", async () => {
    await clean();
    const q = tenantWrapped(new MemoryQueue());
    registerEntryConsumers(q);
    await q.start();

    const itemId = randomUUID();
    const mk = (qty: number) => ({
      messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: TENANT,
      actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        grnId: randomUUID(), poRef: "PO-C", vendorId: randomUUID(),
        warehouseId: WAREHOUSE,
        items: [{ itemCode: "IC-C", itemName: "Nut", acceptedQty: qty, rateMinor: 1000, itemId }],
      },
    });

    // Two concurrent accepts for the SAME item/warehouse.
    await Promise.all([
      q.publish(CONSUMED.grnAccepted, mk(4)),
      q.publish(CONSUMED.grnAccepted, mk(6)),
    ]);
    await q.drain();
    await q.stop();

    const rates = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(stockValuationRates)
        .where(and(
          eq(stockValuationRates.tenantId, TENANT),
          eq(stockValuationRates.itemId, itemId),
          eq(stockValuationRates.warehouseId, WAREHOUSE),
        ))));
    expect(rates).toHaveLength(1);
    // Final on-hand must be 4 + 6 = 10. A lost update would leave 4 or 6.
    expect(rates[0].qty).toBe(10);
    // Both receipts have the same unit cost so WAVG stays 1000 paise.
    expect(rates[0].rateMinor).toBe(1000n);
  });
});
