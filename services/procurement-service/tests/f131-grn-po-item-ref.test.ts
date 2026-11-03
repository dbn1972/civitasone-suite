/**
 * F131 (UAT Phase 2) — the web GRN form sent each line as
 * `procurement_po_item:<poId>:<itemCode>` because PO detail returned no item id,
 * while the grnCreate worker resolves lines against the PO item's own id. Every
 * GRN raised on screen dead-lettered with PO_ITEM_NOT_FOUND (PO/2026/0033).
 *
 *  - PO detail now returns lineItems[].id (the ref a GRN line must send);
 *  - grnCreate resolves the opaque `procurement_po_item:<id>` ref and the
 *    legacy composite (only for the GRN's own PO and an unambiguous item code),
 *    so the command already sitting in the DLQ can be redriven;
 *  - anything else is still refused with PO_ITEM_NOT_FOUND.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { normalizePoItemRef } from "../src/modules/grn/domain.js";
import { getPo } from "../src/modules/po/queries.js";
import { COMMANDS } from "../src/topics.js";

const TENANT   = "f1310000-1111-4000-8000-000000000001";
const ACTOR    = "f1310000-2222-4000-8000-000000000001";
const VENDOR   = "f1310000-4444-4000-8000-000000000001";
const PO_ID    = "f1310000-5555-4000-8000-000000000001";
const OTHER_PO = "f1310000-5555-4000-8000-000000000002";
const ITEM_A   = "f1310000-6666-4000-8000-000000000001";
const ITEM_B   = "f1310000-6666-4000-8000-000000000002";

function wire(q: MemoryQueue): MemoryQueue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
function msg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}

async function wipe(all: boolean): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementInspections).where(eq(procurementInspections.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    if (all) {
      await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
      await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    }
  }));
}

async function seedPo(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id: PO_ID, tenantId: TENANT, poNo: "PO-F131-001", vendorId: VENDOR,
      indentRef: "procurement_indent:seed", status: "approved", totalMinor: 80000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementPoItems).values([
      { id: ITEM_A, poId: PO_ID, tenantId: TENANT, itemCode: "L2-ITM-1", description: "Paper", quantity: 4, unit: "nos", unitPriceMinor: 10000n, createdBy: ACTOR, updatedBy: ACTOR },
      { id: ITEM_B, poId: PO_ID, tenantId: TENANT, itemCode: "L2-ITM-2", description: "Toner", quantity: 2, unit: "nos", unitPriceMinor: 20000n, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
}

async function createGrn(q: MemoryQueue, poItemRef: string): Promise<string> {
  const id = randomUUID();
  await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
    id, tenantId: TENANT, grnNo: `GRN-F131-${id.slice(-6)}`,
    poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
    items: [{ poItemRef, itemCode: "L2-ITM-1", orderedQty: 4, receivedQty: 2, acceptedQty: 2, unit: "nos" }],
  }));
  await q.drain();
  return id;
}

async function grnItems(grnId: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.grnId, grnId))));
}

beforeAll(async () => { await wipe(true); await seedPo(); });
beforeEach(async () => { await wipe(false); });
afterAll(async () => { await wipe(true); await sqlClient.end(); });

describe("F131 normalizePoItemRef (pure)", () => {
  const items = [{ id: ITEM_A, itemCode: "L2-ITM-1" }, { id: ITEM_B, itemCode: "L2-ITM-2" }];
  it("keeps a bare PO item id", () => {
    expect(normalizePoItemRef(ITEM_A, PO_ID, items)).toBe(ITEM_A);
  });
  it("strips the opaque procurement_po_item: prefix", () => {
    expect(normalizePoItemRef(`procurement_po_item:${ITEM_B}`, PO_ID, items)).toBe(ITEM_B);
  });
  it("resolves the legacy composite <poId>:<itemCode> on the GRN's own PO", () => {
    expect(normalizePoItemRef(`procurement_po_item:${PO_ID}:L2-ITM-1`, PO_ID, items)).toBe(ITEM_A);
  });
  it("does not resolve a composite naming another PO, an unknown code, or an ambiguous code", () => {
    expect(normalizePoItemRef(`procurement_po_item:${OTHER_PO}:L2-ITM-1`, PO_ID, items)).toBe(`procurement_po_item:${OTHER_PO}:L2-ITM-1`);
    expect(normalizePoItemRef(`procurement_po_item:${PO_ID}:NOPE`, PO_ID, items)).toBe(`procurement_po_item:${PO_ID}:NOPE`);
    const dup = [...items, { id: "x", itemCode: "L2-ITM-1" }];
    expect(normalizePoItemRef(`procurement_po_item:${PO_ID}:L2-ITM-1`, PO_ID, dup)).toBe(`procurement_po_item:${PO_ID}:L2-ITM-1`);
  });
});

describe("F131 PO detail returns the PO item id", () => {
  it("lineItems[].id is the procurement_po_items id", async () => {
    const po = await runWithTenant(TENANT, () => getPo(PO_ID, TENANT));
    const lines = (po?.lineItems ?? []) as Array<{ id?: string; itemCode: string }>;
    expect(lines.map((l) => [l.itemCode, l.id]).sort()).toEqual([["L2-ITM-1", ITEM_A], ["L2-ITM-2", ITEM_B]]);
  });
});

describe("F131 grnCreate resolves the line ref the web form sent", () => {
  it("records the GRN for the legacy composite ref (was PO_ITEM_NOT_FOUND -> DLQ) and stores the item id", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();
    const grnId = await createGrn(q, `procurement_po_item:${PO_ID}:L2-ITM-1`);
    expect(q.dlq).toEqual([]);
    const items = await grnItems(grnId);
    expect(items).toHaveLength(1);
    expect(items[0]?.poItemRef).toBe(ITEM_A);
    expect(items[0]?.orderedQty).toBe(4);
  });

  it("records the GRN for the PO item id the form now sends", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();
    const grnId = await createGrn(q, ITEM_A);
    expect(q.dlq).toEqual([]);
    expect((await grnItems(grnId))[0]?.poItemRef).toBe(ITEM_A);
  });

  it("still refuses a ref that names another PO's item (PO_ITEM_NOT_FOUND, nothing written)", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();
    const grnId = await createGrn(q, `procurement_po_item:${OTHER_PO}:L2-ITM-1`);
    expect(await grnItems(grnId)).toEqual([]);
    expect(q.dlq.some((d) => d.error.includes("PO_ITEM_NOT_FOUND"))).toBe(true);
  });
});
