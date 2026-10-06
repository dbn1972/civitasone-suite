/**
 * batch7 server-side verification for the procurement RFQ route family:
 *   GAP-PROCUREMENT-RFQ-DETAIL-03 / -06 — sealed-bid discipline: quoted amounts
 *     (and per-line rates) are withheld from getRfqDetail while the RFQ is still
 *     open (issued + closing day not yet passed), and revealed once it closes.
 *   GAP-PROCUREMENT-RFQ-DETAIL-02 — per-line rates + responseId surfaced once
 *     unsealed, so the web comparative statement can mark L1 and award.
 *   GAP-PROCUREMENT-RFQ-05 — the RFQ status enum returned by the queries layer
 *     is exactly draft|issued|closed|cancelled|awarded.
 *   GAP-PROCUREMENT-RFQ-NEW-06 / -02 — create emits an audit event carrying the
 *     invited-vendor count and (when present) the <3-vendors justification.
 *
 * Mirrors tests/dom-011-rfq-lifecycle.test.ts's helper style exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementRfqs, procurementRfqItems, procurementRfqResponses } from "../src/modules/rfq/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { registerRfqConsumers } from "../src/modules/rfq/consumer.js";
import * as queries from "../src/modules/rfq/queries.js";
import * as vendorQueries from "../src/modules/vendor/queries.js";
import { COMMANDS } from "../src/topics.js";

const TENANT   = "b7a70000-1111-4000-8000-000000000001";
const CREATOR  = "b7a70000-2222-4000-8000-000000000001";
const APPROVER = "b7a70000-2222-4000-8000-000000000002";
const VENDOR_A = "b7a70000-3333-4000-8000-000000000001";
const VENDOR_B = "b7a70000-3333-4000-8000-000000000002";

// Dates relative to a fixed "today" for sealing assertions.
const FUTURE = "2999-12-31"; // closing in the future -> still open -> sealed
const PAST   = "2000-01-01"; // closing already passed -> unsealed even if 'issued'

function newQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  registerRfqConsumers(q as unknown as Queue);
  return q;
}

async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 350)); await q.stop(); }

async function createRfq(opts: { closingDate: string; vendorIds: string[]; fewerVendorsJustification?: string }): Promise<{ rfqId: string; itemId: string }> {
  const rfqId = randomUUID();
  const q = newQueue();
  await q.start();
  await q.publish(COMMANDS.rfqCreate, {
    messageId: randomUUID(), type: COMMANDS.rfqCreate, tenantId: TENANT, actorId: CREATOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: rfqId, tenantId: TENANT, title: "batch7 RFQ", closingDate: opts.closingDate,
      vendorIds: opts.vendorIds, items: [{ itemName: "Widget", quantity: 10, unit: "nos" }],
      ...(opts.fewerVendorsJustification ? { fewerVendorsJustification: opts.fewerVendorsJustification } : {}),
    },
  });
  await drain(q);
  const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementRfqItems).where(eq(procurementRfqItems.rfqId, rfqId))));
  return { rfqId, itemId: items[0]!.id };
}

async function respond(rfqId: string, vendorId: string, itemId: string, unitPrice: number): Promise<void> {
  const q = newQueue();
  await q.start();
  await q.publish(COMMANDS.rfqRespond, {
    messageId: randomUUID(), type: COMMANDS.rfqRespond, tenantId: TENANT, actorId: vendorId,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: randomUUID(), tenantId: TENANT, rfqId, vendorId, items: [{ itemId, unitPrice }], termsAccepted: true },
  });
  await drain(q);
}

async function closeRfq(rfqId: string): Promise<void> {
  const q = newQueue();
  await q.start();
  await q.publish(COMMANDS.rfqClose, {
    messageId: randomUUID(), type: COMMANDS.rfqClose, tenantId: TENANT, actorId: APPROVER,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: rfqId, tenantId: TENANT },
  });
  await drain(q);
}

function getDetail(rfqId: string) {
  return runWithTenant(TENANT, () => queries.getRfqDetail(rfqId, TENANT));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementRfqResponses).where(eq(procurementRfqResponses.tenantId, TENANT));
    await tx.delete(procurementRfqItems).where(eq(procurementRfqItems.tenantId, TENANT));
    await tx.delete(procurementRfqs).where(eq(procurementRfqs.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await wipe();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values([
    { id: VENDOR_A, tenantId: TENANT, name: "Vendor A Pvt Ltd", createdBy: CREATOR, updatedBy: CREATOR },
    { id: VENDOR_B, tenantId: TENANT, name: "Vendor B Pvt Ltd", createdBy: CREATOR, updatedBy: CREATOR },
  ])));
});
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("GAP-PROCUREMENT-RFQ-DETAIL-03/-06 — sealed-bid discipline", () => {
  it("an OPEN RFQ (issued, closing in the future) withholds every response amount (sealed=true, totalAmountMinor undefined, no line rates)", async () => {
    const { rfqId, itemId } = await createRfq({ closingDate: FUTURE, vendorIds: [VENDOR_A, VENDOR_B] });
    await respond(rfqId, VENDOR_A, itemId, 100);
    await respond(rfqId, VENDOR_B, itemId, 120);

    const detail = await getDetail(rfqId);
    expect(detail!.status).toBe("issued");
    expect(detail!.responses).toHaveLength(2);
    for (const r of detail!.responses) {
      expect(r.sealed).toBe(true);
      expect(r.totalAmountMinor).toBeUndefined();
      expect(r.lineRates).toEqual([]);
    }
  });

  it("once CLOSED, amounts and per-line rates are revealed (sealed=false), with responseId present (DETAIL-01/-02)", async () => {
    const { rfqId, itemId } = await createRfq({ closingDate: FUTURE, vendorIds: [VENDOR_A, VENDOR_B] });
    await respond(rfqId, VENDOR_A, itemId, 100);
    await respond(rfqId, VENDOR_B, itemId, 120);
    await closeRfq(rfqId);

    const detail = await getDetail(rfqId);
    expect(detail!.status).toBe("closed");
    const a = detail!.responses.find((r) => r.vendorId === VENDOR_A)!;
    expect(a.sealed).toBe(false);
    expect(a.totalAmountMinor).toBe(String(100 * 10 * 100)); // unitPrice * quantity, in paise (string)
    expect(a.lineRates.length).toBeGreaterThan(0);
    expect(a.lineRates[0]!.unitPriceMinor).toBe("10000");
    expect(typeof a.responseId).toBe("string");
    expect(a.responseId.length).toBeGreaterThan(0);
  });

  it("an issued RFQ whose closing day has already passed is NOT sealed (amounts visible for comparison)", async () => {
    const { rfqId, itemId } = await createRfq({ closingDate: PAST, vendorIds: [VENDOR_A] });
    await respond(rfqId, VENDOR_A, itemId, 77);
    const detail = await getDetail(rfqId);
    const a = detail!.responses.find((r) => r.vendorId === VENDOR_A)!;
    expect(a.sealed).toBe(false);
    expect(a.totalAmountMinor).toBe(String(77 * 10 * 100));
  });
});

describe("GAP-PROCUREMENT-RFQ-05 — status enum is exactly the documented set", () => {
  it("getRfqDetail returns a status within draft|issued|closed|cancelled|awarded", async () => {
    const { rfqId } = await createRfq({ closingDate: FUTURE, vendorIds: [VENDOR_A] });
    const detail = await getDetail(rfqId);
    expect(["draft", "issued", "closed", "cancelled", "awarded"]).toContain(detail!.status);
  });
});

describe("GAP-PROCUREMENT-RFQ-NEW-06/-02 — create audit event records vendor count + under-3 justification", () => {
  it("the create audit event (outbox) carries vendorsInvited and the fewer-vendors justification when fewer than 3 are invited", async () => {
    const { rfqId } = await createRfq({ closingDate: FUTURE, vendorIds: [VENDOR_A], fewerVendorsJustification: "Only one empanelled vendor for this specialised item." });

    // The create consumer writes the audit event to the transactional outbox
    // (_outbox.messages) in the same tx as the RFQ row.
    const rows = await runWithTenant(TENANT, () => db.execute(
      sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${rfqId} AND payload->>'action' = 'create'`,
    ));
    const list = (rows as unknown as { rows?: Array<{ payload: Record<string, unknown> }> }).rows
      ?? (rows as unknown as Array<{ payload: Record<string, unknown> }>);
    expect(list.length).toBeGreaterThan(0);
    const payload = list[0]!.payload;
    expect(payload.vendorsInvited).toBe(1);
    expect(payload.fewerVendorsJustification).toBe("Only one empanelled vendor for this specialised item.");
  });
});

describe("GAP-PROCUREMENT-RFQ-NEW-02 — vendor list exposes a blacklist flag for the invite UI", () => {
  it("listVendors marks a vendorType='blacklisted' vendor as blacklisted:true and a normal vendor as false", async () => {
    const bad = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values(
      { id: bad, tenantId: TENANT, name: "Debarred Traders", vendorType: "blacklisted", createdBy: CREATOR, updatedBy: CREATOR },
    )));
    const { data } = await runWithTenant(TENANT, () => vendorQueries.listVendors(TENANT, 100, 0));
    const badRow = data.find((v) => v.id === bad);
    const goodRow = data.find((v) => v.id === VENDOR_A);
    expect(badRow?.blacklisted).toBe(true);
    expect(goodRow?.blacklisted).toBe(false);
  });
});
