/**
 * UAT bundle 10, F95 (T6-07): procurement.grn.accepted producer contract.
 *
 * inventory-service could not post a stock receipt from any accepted GRN: the
 * event carried rateMinor as a string while inventory's private schema wanted a
 * number, `itemId` was the PO line id (not an inventory item), and no receiving
 * store was ever sent. The event is now built through the shared contract
 * (@civitasone/events/contracts procurementGrnAccepted) that inventory also
 * validates against, and it carries the store recorded on the GRN.
 *
 * Drives the real consumer on a MemoryQueue against the disposable test DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { procurementGrnAccepted } from "@civitasone/events/contracts";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT    = randomUUID();
const RECEIVER  = randomUUID();
const INSPECTOR = randomUUID();
const VENDOR    = randomUUID();
const PO_ID     = randomUUID();
const PO_ITEM_ID = randomUUID();
const STORE_ID  = randomUUID();

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
function msg(type: string, payload: Record<string, unknown>, actorId: string, correlationId = `corr-${randomUUID()}`) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId, schemaVersion: "1.0", payload };
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, TENANT));
    await tx.delete(procurementInspections).where(eq(procurementInspections.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id: PO_ID, tenantId: TENANT, poNo: "PO-B10-001", vendorId: VENDOR,
      indentRef: "procurement_indent:seed", status: "approved", totalMinor: 10000n,
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
    await tx.insert(procurementPoItems).values({
      id: PO_ITEM_ID, poId: PO_ID, tenantId: TENANT, itemCode: "B10-ITM-1", description: "Toner",
      quantity: 10, unit: "nos", unitPriceMinor: 1000n, itemType: "consumable",
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
  }));
});
afterAll(async () => { await wipe(); await sqlClient.end(); });

async function acceptedEventFor(storeId?: string): Promise<Record<string, unknown>> {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerGrnConsumers(q);
  await q.start();
  const grnId = randomUUID();
  await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
    id: grnId, tenantId: TENANT, poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
    ...(storeId ? { storeId } : {}),
    items: [{ poItemRef: PO_ITEM_ID, itemCode: "B10-ITM-1", orderedQty: 10, receivedQty: 1, acceptedQty: 1, unit: "nos" }],
  }, RECEIVER));
  await q.drain();
  const corr = `corr-${randomUUID()}`;
  await q.publish(COMMANDS.grnAccept, msg(COMMANDS.grnAccept, { id: grnId, tenantId: TENANT }, INSPECTOR, corr));
  await q.drain();
  await q.stop();
  expect(q.dlq.map((d) => d.error)).toEqual([]);
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, corr))));
  const evt = rows.find((r) => r.eventType === EVENTS.grnAccepted);
  expect(evt, "procurement.grn.accepted was not emitted").toBeDefined();
  return evt!.payload as Record<string, unknown>;
}

describe("F95: procurement.grn.accepted matches the shared contract its consumers validate", () => {
  it("carries the GRN's receiving store, a string rate, and names the PO line id as poItemId", async () => {
    const payload = await acceptedEventFor(STORE_ID);
    expect(procurementGrnAccepted.validate(payload)).toEqual({ ok: true });
    expect(payload.storeId).toBe(STORE_ID);
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemCode: "B10-ITM-1", acceptedQty: 1, rateMinor: "1000", currency: "INR", poItemId: PO_ITEM_ID });
  });

  it("a GRN created without a store still emits a valid event (inventory then refuses it loudly, not silently)", async () => {
    const payload = await acceptedEventFor();
    expect(procurementGrnAccepted.validate(payload)).toEqual({ ok: true });
    expect(payload).not.toHaveProperty("storeId");
  });

  it("persists the receiving store on the GRN row", async () => {
    await acceptedEventFor(STORE_ID);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select({ storeId: procurementGrns.storeId }).from(procurementGrns).where(eq(procurementGrns.tenantId, TENANT))));
    expect(rows.some((r) => r.storeId === STORE_ID)).toBe(true);
  });
});
