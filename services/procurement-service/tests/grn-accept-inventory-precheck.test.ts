/**
 * UAT bundle 23 (DLQ gate): a GRN naming a SKU that is not an inventory item was answered 202 on accept and
 * then dead-lettered silently by inventory's procurement.grn.accepted consumer (UNKNOWN_ITEM_CODE), so the
 * user believed the stock had been received. The inventory DLQ for that consumer grew 10 -> 13 on 9 Nov.
 *
 * PATCH /v1/procurement/grns/:id/accept now asks inventory (read-only pre-check) and refuses synchronously
 * with a 422 naming the line. Unreachable inventory fails open (the consumer still refuses loudly).
 * Real Postgres for the GRN rows; the inventory call is stubbed at its client module.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

const precheck = vi.hoisted(() => vi.fn());
vi.mock("../src/shared/inventory-client.js", () => ({ precheckGrnStock: precheck }));

import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const TENANT = randomUUID();
const RECEIVER = randomUUID();
const INSPECTOR = randomUUID();
const VENDOR = randomUUID();
const PO_ID = randomUUID();
const PO_ITEM = randomUUID();
const PO_ASSET = randomUUID();
const STORE_ID = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const inspectorHdr = () => ({
  authorization: `Bearer ${signToken({ sub: INSPECTOR, tid: TENANT, roles: ["warehouse_officer"], sid: "s-b23" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT, "content-type": "application/json",
});

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
const cmd = (type: string, payload: Record<string, unknown>, actorId: string) =>
  ({ messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload });

async function wipe() {
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
      id: PO_ID, tenantId: TENANT, poNo: "PO/2026-27/0412", vendorId: VENDOR, indentRef: "procurement_indent:seed",
      status: "approved", totalMinor: 90000n, createdBy: RECEIVER, updatedBy: RECEIVER,
    });
    await tx.insert(procurementPoItems).values([
      { id: PO_ITEM, poId: PO_ID, tenantId: TENANT, itemCode: "STN-A4-75GSM", description: "A4 paper 75 GSM, ream", quantity: 100, unit: "ream", unitPriceMinor: 28000n, itemType: "consumable", createdBy: RECEIVER, updatedBy: RECEIVER },
      { id: PO_ASSET, poId: PO_ID, tenantId: TENANT, itemCode: "FA-LAPTOP-14", description: "Laptop 14 inch", quantity: 20, unit: "nos", unitPriceMinor: 5500000n, itemType: "fixed_asset", createdBy: RECEIVER, updatedBy: RECEIVER },
    ]);
  }));
});
afterAll(async () => { await wipe(); await sqlClient.end(); });
beforeEach(() => { precheck.mockReset(); });

async function createGrn(lines: Array<{ ref: string; code: string }>): Promise<string> {
  const q = wire(new MemoryQueue()) as MemoryQueue;
  registerGrnConsumers(q);
  await q.start();
  const grnId = randomUUID();
  await q.publish(COMMANDS.grnCreate, cmd(COMMANDS.grnCreate, {
    id: grnId, tenantId: TENANT, poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
    items: lines.map((l) => ({ poItemRef: l.ref, itemCode: l.code, orderedQty: 100, receivedQty: 10, acceptedQty: 10, unit: "ream" })),
  }, RECEIVER));
  await q.drain();
  await q.stop();
  return grnId;
}

async function accept(grnId: string, payload: Record<string, unknown> = { storeId: STORE_ID }) {
  const app = await buildApp();
  try {
    return await app.inject({ method: "PATCH", url: `/v1/procurement/grns/${grnId}/accept`, headers: inspectorHdr(), payload });
  } finally { await app.close(); }
}
const acceptsPublished = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => c[0] === COMMANDS.grnAccept).length;

describe("GRN accept: synchronous inventory pre-check", () => {
  it("unknown SKU: 422 UNKNOWN_ITEM_CODE naming the line, and no accept command is published", async () => {
    const grnId = await createGrn([{ ref: PO_ITEM, code: "STN-A4-75GSM" }]);
    precheck.mockResolvedValue({ unknownSkus: ["STN-A4-75GSM"], ambiguousSkus: [], storeKnown: true });
    const publish = vi.spyOn(appQueue, "publish");
    const res = await accept(grnId);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("UNKNOWN_ITEM_CODE");
    expect(JSON.stringify(res.json())).toContain("items.0.itemCode");
    expect(acceptsPublished(publish)).toBe(0);
    expect(precheck).toHaveBeenCalledWith(TENANT, ["STN-A4-75GSM"], STORE_ID);
    publish.mockRestore();
  });

  it("ambiguous SKU: 422 AMBIGUOUS_ITEM_CODE", async () => {
    const grnId = await createGrn([{ ref: PO_ITEM, code: "STN-A4-75GSM" }]);
    precheck.mockResolvedValue({ unknownSkus: [], ambiguousSkus: ["STN-A4-75GSM"], storeKnown: true });
    const res = await accept(grnId);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("AMBIGUOUS_ITEM_CODE");
  });

  it("unknown receiving store: 422 UNKNOWN_STORE on storeId", async () => {
    const grnId = await createGrn([{ ref: PO_ITEM, code: "STN-A4-75GSM" }]);
    precheck.mockResolvedValue({ unknownSkus: [], ambiguousSkus: [], storeKnown: false });
    const res = await accept(grnId);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("UNKNOWN_STORE");
  });

  it("known SKU and store: accepted 202", async () => {
    const grnId = await createGrn([{ ref: PO_ITEM, code: "STN-A4-75GSM" }]);
    precheck.mockResolvedValue({ unknownSkus: [], ambiguousSkus: [], storeKnown: true });
    expect((await accept(grnId)).statusCode).toBe(202);
  });

  it("inventory unreachable (null): fails open, accepted 202", async () => {
    const grnId = await createGrn([{ ref: PO_ITEM, code: "STN-A4-75GSM" }]);
    precheck.mockResolvedValue(null);
    expect((await accept(grnId)).statusCode).toBe(202);
  });

  it("fixed-asset lines are not stock: inventory is not asked, accepted 202", async () => {
    const grnId = await createGrn([{ ref: PO_ASSET, code: "FA-LAPTOP-14" }]);
    const res = await accept(grnId, {});
    expect(res.statusCode).toBe(202);
    expect(precheck).not.toHaveBeenCalled();
  });
});
