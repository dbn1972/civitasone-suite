/**
 * GAP-STOCK-LEDGER-NEW-04 (UAT B4): the stock-entry reason is a structured field --
 * accepted by the POST validator, stored on the entry row, and carried in the
 * stock entry audit event (instead of being folded into free-text notes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { stockEntries, stockEntryItems } from "../src/modules/entry/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { stockReceipts } from "../src/modules/receipt/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import { createEntryBody } from "../src/modules/entry/validators.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const WAREHOUSE = randomUUID();

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
    await tx.delete(stockEntryItems).where(eq(stockEntryItems.tenantId, TENANT));
    await tx.delete(stockEntries).where(eq(stockEntries.tenantId, TENANT));
    await tx.delete(stockValuationRates).where(eq(stockValuationRates.tenantId, TENANT));
    await tx.delete(stockReceipts).where(eq(stockReceipts.tenantId, TENANT));
  }));
}

async function post(payload: Record<string, unknown>) {
  const q = tenantWrapped(new MemoryQueue());
  registerEntryConsumers(q);
  await q.start();
  await q.publish(COMMANDS.entryCreate, {
    messageId: payload.id as string, type: COMMANDS.entryCreate, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
}

beforeAll(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("validator", () => {
  const base = { entryType: "adjustment", postingDate: "2026-10-01", toWarehouseId: WAREHOUSE, items: [{ itemId: randomUUID(), qty: 1 }] };
  it("accepts a reason, trims it, and rejects a blank or oversized one", () => {
    expect(createEntryBody.parse({ ...base, reason: "  cycle count variance  " }).reason).toBe("cycle count variance");
    expect(createEntryBody.safeParse({ ...base, reason: "   " }).success).toBe(false);
    expect(createEntryBody.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
  });
  it("keeps reason optional (receipts and legacy callers do not send one)", () => {
    expect(createEntryBody.safeParse(base).success).toBe(true);
  });
});

describe("entry consumer", () => {
  it("stores the reason on the entry and puts it in the audit event", async () => {
    const id = randomUUID();
    await post({
      id, tenantId: TENANT, entryType: "adjustment", postingDate: "2026-10-01",
      toWarehouseId: WAREHOUSE, reason: "Damaged in flood",
      notes: "shelf B3", items: [{ itemId: randomUUID(), qty: 3, rateMinor: 500 }],
    });
    const [entry] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(stockEntries).where(eq(stockEntries.id, id))));
    expect(entry?.reason).toBe("Damaged in flood");
    expect(entry?.notes).toBe("shelf B3");

    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
    const p = audits.map((r) => r.payload as Record<string, unknown>).find((x) => x.resourceId === id);
    expect(p).toMatchObject({ service: "stock", action: "create", resourceType: "stock_entry", outcome: "success", reason: "Damaged in flood" });
  });

  it("an entry without a reason stores null and omits the audit field", async () => {
    const id = randomUUID();
    await post({
      id, tenantId: TENANT, entryType: "receipt", postingDate: "2026-10-01",
      toWarehouseId: WAREHOUSE, items: [{ itemId: randomUUID(), qty: 2, rateMinor: 100 }],
    });
    const [entry] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(stockEntries).where(eq(stockEntries.id, id))));
    expect(entry?.reason).toBeNull();
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record")))));
    const p = audits.map((r) => r.payload as Record<string, unknown>).find((x) => x.resourceId === id);
    expect(p).toBeDefined();
    expect("reason" in (p as object)).toBe(false);
  });
});
