/**
 * Regression: the GRN-accepted and physical-verification consumers passed composite,
 * non-uuid keys ("<messageId>:<itemCode>") to markProcessed(), but _inbox.processed.message_id is a
 * uuid column. Every delivery threw "invalid input syntax for type uuid" and was dead-lettered, so
 * neither flow ever wrote anything. Real Postgres, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { stockReceipts } from "../src/modules/receipt/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import { CONSUMED, COMMANDS } from "../src/topics.js";

const TENANT = "9c1c2000-dead-4000-8000-0000009c2c10";
const OFFICER = "9c1c2000-dead-4000-8000-0000009c2c0f";
const WAREHOUSE = "9c1c2000-dead-4000-8000-0000009c2cfb";

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

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
    await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, TENANT));
    await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, TENANT));
  }));
}
const ledger = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(stockLedger).where(eq(stockLedger.tenantId, TENANT))));

let q: MemoryQueue;
beforeAll(async () => {
  await clean();
  q = tenantWrapped(new MemoryQueue()) as unknown as MemoryQueue;
  registerEntryConsumers(q as unknown as Queue);
  await q.start();
});
afterAll(async () => { await q.stop(); await clean(); await sqlClient.end(); });

describe("stock consumers fold composite dedupe keys into a uuid", () => {
  it("GRN accepted: no dead-letter, receipt posted once, redelivery of the same message is a no-op", async () => {
    const itemId = randomUUID();
    const msg = {
      messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: TENANT, actorId: OFFICER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { grnId: randomUUID(), poRef: "PO-1", vendorId: randomUUID(), warehouseId: WAREHOUSE,
        items: [{ itemCode: "IC-1", itemName: "Pen", itemId, acceptedQty: 4, rateMinor: 250 }] },
    };
    await q.publish(CONSUMED.grnAccepted, msg);
    await q.drain();
    expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
    expect((await ledger()).filter((r) => r.itemId === itemId)).toHaveLength(1);

    await q.publish(CONSUMED.grnAccepted, msg);
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect((await ledger()).filter((r) => r.itemId === itemId)).toHaveLength(1);
  });

  it("physical verification: no dead-letter, adjustment posted once, redelivery is a no-op", async () => {
    const itemId = randomUUID();
    const msg = {
      messageId: randomUUID(), type: COMMANDS.physicalCreate, tenantId: TENANT, actorId: OFFICER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, warehouseId: WAREHOUSE, postingDate: "2026-09-10",
        items: [{ itemId, countedQty: 7 }] },
    };
    await q.publish(COMMANDS.physicalCreate, msg);
    await q.drain();
    expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
    expect((await ledger()).filter((r) => r.itemId === itemId)).toHaveLength(1);

    await q.publish(COMMANDS.physicalCreate, msg);
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    // second delivery: valuation already 7 -> diff 0 -> and/or inbox dedupe; either way still one row
    expect((await ledger()).filter((r) => r.itemId === itemId)).toHaveLength(1);
  });
});
