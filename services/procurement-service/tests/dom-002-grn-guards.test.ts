/**
 * DOM-002 — GRN over-receipt guard was client-controlled and disabled on
 * amend; GRN creation had no separation of duties between receiver and
 * inspector. Regression + sabotage-checked tests for all three sub-bugs
 * fixed in grn/consumer.ts + grn/domain.ts:
 *
 *   1. orderedQty is now re-derived from the real PO line server-side on
 *      create (never trusted from the client payload) — a client that lies
 *      about orderedQty to hide an over-receipt is rejected.
 *   2. Amend re-derives orderedQty from the GRN line actually persisted at
 *      create time, instead of the hardcoded `orderedQty: 0` that disabled
 *      the over-accept cap entirely on every amendment.
 *   3. The receiving actor (GRN creator) and the inspector must be distinct
 *      actors (assertDistinctReceiverInspector, SOD_VIOLATION) — mirrors
 *      po/amendment-domain.ts's assertDistinctMakerChecker convention.
 *
 * Drives the real consumer (registerGrnConsumers) on a MemoryQueue against
 * the real Postgres test DB, mirroring grn-amendment.test.ts /
 * po-amendment-lifecycle.test.ts's integration style. MemoryQueue never
 * rejects deliver() — failures land in `q.dlq` — so each negative case is
 * asserted both by DB state (nothing persisted / nothing changed) and by
 * the DLQ error message carrying the expected domain-error code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT    = "9d000000-1111-4000-8000-000000000001";
const RECEIVER  = "9d000000-2222-4000-8000-000000000001"; // the actor who creates/receives the GRN
const INSPECTOR = "9d000000-3333-4000-8000-000000000001"; // a genuinely distinct inspector
const VENDOR    = "9d000000-4444-4000-8000-000000000001";

const PO_ID     = "9d000000-5555-4000-8000-000000000001";
const PO_ITEM_ID = "9d000000-6666-4000-8000-000000000001";
const REAL_ORDERED_QTY = 5;

function wire(q: MemoryQueue): MemoryQueue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
function msg(type: string, payload: Record<string, unknown>, actorId: string) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${type}-${randomUUID()}`, schemaVersion: "1.0", payload };
}

async function seedPo(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id: PO_ID, tenantId: TENANT, poNo: "PO-DOM002-001", vendorId: VENDOR,
      indentRef: "procurement_indent:seed", status: "approved", totalMinor: 50000n,
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
    await tx.insert(procurementPoItems).values({
      id: PO_ITEM_ID, poId: PO_ID, tenantId: TENANT, itemCode: "LAP-001", description: "Laptop",
      quantity: REAL_ORDERED_QTY, unit: "nos", unitPriceMinor: 10000n,
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
  }));
}

async function seedGrnForAmend(grnId: string, lineId: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementGrns).values({
      id: grnId, tenantId: TENANT, grnNo: `GRN-DOM002-${grnId.slice(-4)}`,
      poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
      receivedDate: "2026-01-01", threeWayMatch: false, status: "draft",
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
    // orderedQty here is what create would now persist server-derived from
    // the real PO line — REAL_ORDERED_QTY, not whatever a client claims.
    await tx.insert(procurementGrnItems).values({
      id: lineId, grnId, tenantId: TENANT,
      poItemRef: PO_ITEM_ID, itemCode: "LAP-001",
      orderedQty: REAL_ORDERED_QTY, receivedQty: 3, acceptedQty: 3, unit: "nos",
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
  }));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

beforeAll(async () => { await wipe(); await seedPo(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("DOM-002.1 — over-receipt guard uses the real PO-derived orderedQty, not client input", () => {
  it("rejects a GRN that lies about orderedQty to hide an over-receipt (real PO qty is 5, client claims 999)", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = randomUUID();
    await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
      id: grnId, tenantId: TENANT, grnNo: "GRN-OVERRECEIPT-1",
      poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
      items: [{
        poItemRef: PO_ITEM_ID, itemCode: "LAP-001",
        // Client lies: claims 999 ordered so a 50-unit accept looks in-bounds.
        // The real PO line only ordered REAL_ORDERED_QTY (5).
        orderedQty: 999, receivedQty: 50, acceptedQty: 50, unit: "nos",
      }],
      inspection: { inspectorId: INSPECTOR, result: "pass" },
    }, RECEIVER));
    await q.drain();

    const grns = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
    expect(grns).toHaveLength(0);
    expect(q.dlq.some((d) => d.error.includes("OVER_ACCEPT"))).toBe(true);
  });

  it("accepts a GRN within the real PO-derived quantity (control: guard doesn't over-reject)", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = randomUUID();
    await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
      id: grnId, tenantId: TENANT, grnNo: "GRN-WITHINBOUNDS-1",
      poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
      items: [{
        poItemRef: PO_ITEM_ID, itemCode: "LAP-001",
        orderedQty: 1, receivedQty: REAL_ORDERED_QTY, acceptedQty: REAL_ORDERED_QTY, unit: "nos",
      }],
      inspection: { inspectorId: INSPECTOR, result: "pass" },
    }, RECEIVER));
    await q.drain();

    const grns = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
    expect(grns).toHaveLength(1);
    expect(grns[0]?.status).toBe("accepted");

    // The persisted orderedQty is the server-derived value (5), not the
    // client's lowball 1 — proves the DB record itself is now trustworthy.
    const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.grnId, grnId))));
    expect(items[0]?.orderedQty).toBe(REAL_ORDERED_QTY);
  });
});

describe("DOM-002.2 — amend cannot bypass the over-receipt guard", () => {
  it("rejects an amendment that over-accepts against the GRN line's real orderedQty", async () => {
    const grnId = randomUUID();
    const lineId = randomUUID();
    await seedGrnForAmend(grnId, lineId);

    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    await q.publish(COMMANDS.grnAmend, msg(COMMANDS.grnAmend, {
      id: grnId, tenantId: TENANT,
      // REAL_ORDERED_QTY is 5; this amendment tries to accept 50.
      lines: [{ lineId, receivedQty: 50, acceptedQty: 50 }],
    }, RECEIVER));
    await q.drain();

    const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.id, lineId))));
    expect(items[0]?.receivedQty).toBe(3);
    expect(items[0]?.acceptedQty).toBe(3);
    expect(q.dlq.some((d) => d.error.includes("OVER_ACCEPT"))).toBe(true);
  });

  it("allows an amendment within the real orderedQty (control)", async () => {
    const grnId = randomUUID();
    const lineId = randomUUID();
    await seedGrnForAmend(grnId, lineId);

    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    await q.publish(COMMANDS.grnAmend, msg(COMMANDS.grnAmend, {
      id: grnId, tenantId: TENANT,
      lines: [{ lineId, receivedQty: REAL_ORDERED_QTY, acceptedQty: REAL_ORDERED_QTY }],
    }, RECEIVER));
    await q.drain();

    const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.id, lineId))));
    expect(items[0]?.receivedQty).toBe(REAL_ORDERED_QTY);
    expect(items[0]?.acceptedQty).toBe(REAL_ORDERED_QTY);
  });
});

describe("DOM-002.3 — receiver/inspector separation of duties", () => {
  it("rejects a GRN where the receiving actor is also the inspector", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = randomUUID();
    await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
      id: grnId, tenantId: TENANT, grnNo: "GRN-SELFINSPECT-1",
      poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
      items: [{
        poItemRef: PO_ITEM_ID, itemCode: "LAP-001",
        orderedQty: REAL_ORDERED_QTY, receivedQty: 2, acceptedQty: 2, unit: "nos",
      }],
      // Same actor as the message's actorId (RECEIVER) below — self-inspection.
      inspection: { inspectorId: RECEIVER, result: "pass" },
    }, RECEIVER));
    await q.drain();

    const grns = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
    expect(grns).toHaveLength(0);
    expect(q.dlq.some((d) => d.error.includes("SOD_VIOLATION"))).toBe(true);
  });

  it("accepts a GRN where the receiver and inspector are distinct actors (control)", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = randomUUID();
    await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
      id: grnId, tenantId: TENANT, grnNo: "GRN-DISTINCT-1",
      poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
      items: [{
        poItemRef: PO_ITEM_ID, itemCode: "LAP-001",
        orderedQty: REAL_ORDERED_QTY, receivedQty: 2, acceptedQty: 2, unit: "nos",
      }],
      inspection: { inspectorId: INSPECTOR, result: "pass" },
    }, RECEIVER));
    await q.drain();

    const grns = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
    expect(grns).toHaveLength(1);
    expect(grns[0]?.status).toBe("accepted");
  });
});
