/**
 * UAT bundle 10, F95 (T6-07): procurement.grn.accepted -> inventory stock receipt.
 *
 * No GRN stock receipt had posted since 12 Aug. inventory's private schema
 * disagreed with what procurement sends: rateMinor arrives as a money STRING
 * (zod wanted a number, so every message failed and was retried into the DLQ),
 * `itemId` is the PO line id (not an inventory item), and no store was sent (a
 * missing store was a silent ack). The consumer now validates the shared
 * contract, resolves the item by itemCode (= inventory SKU), takes the store
 * from the event, and refuses anything it cannot post with a NonRetryable error
 * (one delivery, error log), never silently.
 *
 * The first case replays the exact payload shape sampled from the UAT DLQ
 * (procurement-grn-accepted__inventory-service-dlq), plus the store.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { procurementGrnAccepted } from "@civitasone/events/contracts";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import { CONSUMED } from "../src/topics.js";
import { items } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { movements, movementLines, stockBalances, stockLedger } from "../src/modules/movements/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const ITEM = randomUUID();
const STORE = randomUUID();
const SKU = `B10-ITM-${randomUUID().slice(0, 6)}`;

function countingQueue(): { q: MemoryQueue; deliveries: () => number } {
  const q = new MemoryQueue({ maxAttempts: 5 });
  let n = 0;
  const raw = q.subscribe.bind(q);
  (q as Queue).subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer((async (m: unknown) => { n += 1; await (h as (x: unknown) => Promise<void>)(m); }) as Handler) as Handler)) as Queue["subscribe"];
  registerMovementConsumers(q);
  return { q, deliveries: () => n };
}

/** The shape procurement actually emits (sampled from the UAT DLQ), with the receiving store added. */
function dlqShapedPayload(over: Record<string, unknown> = {}, line: Record<string, unknown> = {}): Record<string, unknown> {
  const poLine = randomUUID();
  return {
    poNo: "PO/2026/0014", grnId: randomUUID(),
    items: [{ itemId: poLine, poItemId: poLine, currency: "INR", itemCode: SKU, itemName: "W7 po item", itemType: "consumable", rateMinor: "1000", acceptedQty: 2, ...line }],
    poRef: `procurement_po:${randomUUID()}`, vendorId: randomUUID(),
    grossMinor: "2000", poAmountMinor: "2000", grnAmountMinor: "2000",
    storeId: STORE,
    ...over,
  };
}

async function deliver(payload: Record<string, unknown>) {
  const { q, deliveries } = countingQueue();
  await q.start();
  await q.publish(CONSUMED.grnAccepted, {
    messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return { dlq: q.dlq, deliveries: deliveries() };
}

async function receiptsFor(grnId: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(movements).where(eq(movements.refNo, grnId))));
}

beforeAll(async () => {
  // The GRN reference lookup is best-effort; keep it offline.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("procurement offline in this test"); }));
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(items).values({ id: ITEM, tenantId: TENANT, name: "B10 toner", sku: SKU, reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(stores).values({ id: STORE, tenantId: TENANT, name: "B10 main store", code: "B10-S1", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
    await tx.delete(movementLines).where(eq(movementLines.tenantId, TENANT));
    await tx.delete(movements).where(eq(movements.tenantId, TENANT));
    await tx.delete(stockBalances).where(eq(stockBalances.tenantId, TENANT));
    await tx.delete(stores).where(eq(stores.tenantId, TENANT));
    await tx.delete(items).where(eq(items.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("F95: an accepted GRN posts a stock receipt (shared procurement.grn.accepted contract)", () => {
  it("the DLQ-shaped payload (string rate, PO line id, item by code) is a valid contract payload and posts the receipt", async () => {
    const payload = dlqShapedPayload();
    expect(procurementGrnAccepted.validate(payload)).toEqual({ ok: true });
    const { dlq } = await deliver(payload);
    expect(dlq.map((d) => d.error)).toEqual([]);

    const recs = await receiptsFor(payload.grnId as string);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ movementType: "receipt", toStoreId: STORE, refDoc: "GRN" });
    const bal = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(stockBalances).where(eq(stockBalances.itemId, ITEM))));
    expect(bal[0]).toMatchObject({ storeId: STORE, onHandQty: 2 });
    expect(bal[0]!.avgRateMinor).toBe(1000n);
  });

  it("no receiving store: refused once (NonRetryable) as GRN_NO_RECEIVING_STORE, never a silent ack", async () => {
    const payload = dlqShapedPayload({ storeId: undefined });
    delete payload.storeId;
    const { dlq, deliveries } = await deliver(payload);
    expect(deliveries).toBe(1);
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.error).toMatch(/GRN_NO_RECEIVING_STORE/);
    expect(await receiptsFor(payload.grnId as string)).toHaveLength(0);
  });

  it("an itemCode with no inventory item (SKU): refused once as UNKNOWN_ITEM_CODE, nothing posted", async () => {
    const payload = dlqShapedPayload({}, { itemCode: "NO-SUCH-SKU" });
    const { dlq, deliveries } = await deliver(payload);
    expect(deliveries).toBe(1);
    expect(dlq[0]?.error).toMatch(/UNKNOWN_ITEM_CODE: .*NO-SUCH-SKU/);
    expect(await receiptsFor(payload.grnId as string)).toHaveLength(0);
  });

  it("a store that is not this tenant's: refused once as UNKNOWN_STORE", async () => {
    const payload = dlqShapedPayload({ storeId: randomUUID() });
    const { dlq, deliveries } = await deliver(payload);
    expect(deliveries).toBe(1);
    expect(dlq[0]?.error).toMatch(/UNKNOWN_STORE/);
  });

  it("a payload that breaks the contract (missing itemCode): refused once as GRN_CONTRACT_VIOLATION", async () => {
    const payload = dlqShapedPayload();
    delete ((payload.items as Array<Record<string, unknown>>)[0]!).itemCode;
    const { dlq, deliveries } = await deliver(payload);
    expect(deliveries).toBe(1);
    expect(dlq[0]?.error).toMatch(/GRN_CONTRACT_VIOLATION/);
  });

  it("a GRN with only fixed-asset lines moves no stock and is acked (asset-service registers those)", async () => {
    const payload = dlqShapedPayload({ storeId: undefined }, { itemType: "fixed_asset" });
    delete payload.storeId;
    const { dlq } = await deliver(payload);
    expect(dlq).toHaveLength(0);
    expect(await receiptsFor(payload.grnId as string)).toHaveLength(0);
  });
});
