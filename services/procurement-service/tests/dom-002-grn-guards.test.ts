/**
 * DOM-002 — GRN over-receipt guard was client-controlled and disabled on
 * amend; GRN creation had no REAL separation of duties between receiver and
 * inspector (the "inspector" was a client-supplied field on the same
 * request as create — never a second, independently authenticated actor).
 * Regression + sabotage-checked tests for all three sub-bugs:
 *
 *   1. orderedQty is re-derived from the real PO line server-side on create
 *      (never trusted from the client payload) — a client that lies about
 *      orderedQty to hide an over-receipt is rejected.
 *   2. Amend re-derives orderedQty from the GRN line actually persisted at
 *      create time, instead of the hardcoded `orderedQty: 0` that disabled
 *      the over-accept cap entirely on every amendment.
 *   3. GRN creation (grnCreate) is now a receive-only step: it persists the
 *      GRN into `under_inspection` with NO inspection verdict and NO
 *      inspector identity attached. A genuinely separate, independently
 *      authenticated actor (a different `msg.actorId` on its OWN
 *      COMMANDS.grnAccept / COMMANDS.grnReject call — never a field inside
 *      the create payload) must inspect it afterwards
 *      (assertDistinctReceiverInspector, SOD_VIOLATION) — mirrors
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
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT    = "9d000000-1111-4000-8000-000000000001";
const RECEIVER  = "9d000000-2222-4000-8000-000000000001"; // the actor who creates/receives the GRN
const INSPECTOR = "9d000000-3333-4000-8000-000000000001"; // a genuinely distinct, independently-authenticated inspector
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

/** Publishes a real grnCreate and drains it. Returns the GRN id. */
async function createGrnViaRealFlow(
  q: MemoryQueue,
  overrides: { itemOrderedQty?: number; receivedQty?: number; acceptedQty?: number; grnNo?: string } = {},
): Promise<string> {
  const grnId = randomUUID();
  await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
    id: grnId, tenantId: TENANT, grnNo: overrides.grnNo ?? `GRN-${grnId.slice(-8)}`,
    poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
    items: [{
      poItemRef: PO_ITEM_ID, itemCode: "LAP-001",
      orderedQty: overrides.itemOrderedQty ?? REAL_ORDERED_QTY,
      receivedQty: overrides.receivedQty ?? REAL_ORDERED_QTY,
      acceptedQty: overrides.acceptedQty ?? REAL_ORDERED_QTY,
      unit: "nos",
    }],
    // DOM-002 — no `inspection` field: grnCreate is receive-only now. There
    // is deliberately no way to supply an inspector or a verdict here.
  }, RECEIVER));
  await q.drain();
  return grnId;
}

async function getGrn(grnId: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId))));
  return rows[0] ?? null;
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
    }, RECEIVER));
    await q.drain();

    expect(await getGrn(grnId)).toBeNull();
    expect(q.dlq.some((d) => d.error.includes("OVER_ACCEPT"))).toBe(true);
  });

  it("receives a GRN within the real PO-derived quantity, landing in under_inspection (control: guard doesn't over-reject)", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = await createGrnViaRealFlow(q, { itemOrderedQty: 1, grnNo: "GRN-WITHINBOUNDS-1" });

    const grn = await getGrn(grnId);
    expect(grn).not.toBeNull();
    // DOM-002 — create no longer decides accepted/rejected; it lands in
    // under_inspection awaiting a separate inspector.
    expect(grn?.status).toBe("under_inspection");
    expect(grn?.threeWayMatch).toBe(false);

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

describe("DOM-002.3 — receiver/inspector separation of duties is a REAL two-actor, two-call check", () => {
  it("create never decides accepted/rejected — draft/under_inspection is genuinely reachable through the real create flow, not just a direct SQL insert", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = await createGrnViaRealFlow(q, { grnNo: "GRN-REACHABLE-1" });
    const grn = await getGrn(grnId);
    expect(grn?.status).toBe("under_inspection");

    // No inspection row exists yet — inspection is a wholly separate step.
    const insp = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementInspections).where(eq(procurementInspections.grnId, grnId))));
    expect(insp).toHaveLength(0);
  });

  it("rejects COMMANDS.grnAccept when the accepting actor is the SAME actor who created the GRN — two independent calls, same identity", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    // Call 1 — an independent create by RECEIVER.
    const grnId = await createGrnViaRealFlow(q, { grnNo: "GRN-SELFINSPECT-1" });
    expect((await getGrn(grnId))?.status).toBe("under_inspection");

    // Call 2 — a SEPARATE, independent accept command, but from the SAME
    // actor (RECEIVER again). This is not a field inside the create
    // payload — it's a wholly distinct message on its own topic, exactly
    // like a second, real HTTP request would be.
    await q.publish(COMMANDS.grnAccept, msg(COMMANDS.grnAccept, { id: grnId, tenantId: TENANT }, RECEIVER));
    await q.drain();

    const grn = await getGrn(grnId);
    // Self-inspection must be rejected: the GRN stays under_inspection.
    expect(grn?.status).toBe("under_inspection");
    expect(q.dlq.some((d) => d.error.includes("SOD_VIOLATION"))).toBe(true);
  });

  it("accepts COMMANDS.grnAccept when the accepting actor is genuinely different from the creator — two independent, correctly-authenticated calls", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    // Call 1 — create, authenticated as RECEIVER.
    const grnId = await createGrnViaRealFlow(q, { grnNo: "GRN-DISTINCT-1" });
    expect((await getGrn(grnId))?.status).toBe("under_inspection");

    // Call 2 — accept, authenticated as INSPECTOR, a genuinely different
    // actor, on its own independent command/topic.
    await q.publish(COMMANDS.grnAccept, msg(COMMANDS.grnAccept, { id: grnId, tenantId: TENANT, remarks: "looks good" }, INSPECTOR));
    await q.drain();

    const grn = await getGrn(grnId);
    expect(grn?.status).toBe("accepted");
    expect(grn?.threeWayMatch).toBe(true);

    const insp = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementInspections).where(eq(procurementInspections.grnId, grnId))));
    expect(insp[0]?.inspectorId).toBe(INSPECTOR);
    expect(insp[0]?.result).toBe("pass");
  });

  it("rejects COMMANDS.grnReject when the rejecting actor is the SAME actor who created the GRN", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = await createGrnViaRealFlow(q, { grnNo: "GRN-SELFREJECT-1" });
    await q.publish(COMMANDS.grnReject, msg(COMMANDS.grnReject, { id: grnId, tenantId: TENANT, reason: "damaged" }, RECEIVER));
    await q.drain();

    expect((await getGrn(grnId))?.status).toBe("under_inspection");
    expect(q.dlq.some((d) => d.error.includes("SOD_VIOLATION"))).toBe(true);
  });

  it("accepts COMMANDS.grnReject from a genuinely distinct inspector", async () => {
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();

    const grnId = await createGrnViaRealFlow(q, { grnNo: "GRN-REALREJECT-1" });
    await q.publish(COMMANDS.grnReject, msg(COMMANDS.grnReject, { id: grnId, tenantId: TENANT, reason: "damaged on arrival" }, INSPECTOR));
    await q.drain();

    const grn = await getGrn(grnId);
    expect(grn?.status).toBe("rejected");
    expect(grn?.threeWayMatch).toBe(false);
  });
});
