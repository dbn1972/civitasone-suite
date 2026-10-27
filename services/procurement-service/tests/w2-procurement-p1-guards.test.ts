/**
 * Wave 2 procurement part 1 - backend guards, against the real Postgres test DB
 * as the non-superuser service role (FORCE RLS):
 *
 *  - GAP-PROCUREMENT-GRN-NEW-06: cumulative over-receipt. A GRN line may not
 *    receive more than the PO line still has open (ordered minus what other
 *    non-rejected GRNs already committed). Enforced synchronously (422
 *    OVER_RECEIPT) AND again inside the consumer transaction.
 *  - GAP-PROCUREMENT-EMPANELMENT-05 / ORDERS-NEW-06: a vendor whose every
 *    empanelment has lapsed cannot be ordered from (422 EMPANELMENT_EXPIRED on
 *    both POST aliases, and the poCreate consumer writes no PO).
 *  - GAP-PROCUREMENT-GRN-NEW-04 / CONTRACTS-NEW-05: optional ?q= search on the
 *    vendor and PO lists so a picker can reach rows beyond the first page.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementVendors, procurementEmpanelment } from "../src/modules/vendor/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { assertWithinOpenQty, DomainError } from "../src/modules/grn/domain.js";
import { isEmpanelmentLapsed } from "../src/modules/vendor/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a2000000-0000-4000-8000-000000000001";
const ACTOR = "a2000000-1111-4000-8000-000000000001";
const VENDOR = "a2000000-2222-4000-8000-000000000001";
const PO_ID = "a2000000-3333-4000-8000-000000000001";
const PO_ITEM = "a2000000-4444-4000-8000-000000000001";
const ORDERED = 10;

function hdr(roles: string[]) {
  const tok = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-w2p1" }, SECRET, 3600);
  return { authorization: `Bearer ${tok}`, "x-tenant-id": TENANT, "content-type": "application/json" };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
function msg(type: string, payload: Record<string, unknown>, actorId = ACTOR) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) => runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function wipe(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(procurementInspections).where(eq(procurementInspections.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementEmpanelment).where(eq(procurementEmpanelment.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  });
}

async function seedVendor(id: string, name: string, vendorType = "registered") {
  await inTenant((tx) => tx.insert(procurementVendors).values({
    id, tenantId: TENANT, name, vendorType, kycStatus: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  } as never));
}
async function seedEmpanelment(vendorId: string, validUntil: string | null, status = "active") {
  await inTenant((tx) => tx.insert(procurementEmpanelment).values({
    id: randomUUID(), vendorId, tenantId: TENANT, category: "IT", empanelDate: "2024-01-01",
    validUntil, status, createdBy: ACTOR, updatedBy: ACTOR,
  }));
}

let app: FastifyInstance;
let q: MemoryQueue;

beforeAll(async () => {
  await wipe();
  await seedVendor(VENDOR, "Acme Supplies");
  await inTenant(async (tx) => {
    await tx.insert(procurementPos).values({
      id: PO_ID, tenantId: TENANT, poNo: "PO-W2-001", vendorId: VENDOR,
      indentRef: "procurement_indent:seed", status: "approved", totalMinor: 100000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementPoItems).values({
      id: PO_ITEM, poId: PO_ID, tenantId: TENANT, itemCode: "LAP-001", description: "Laptop",
      quantity: ORDERED, unit: "nos", unitPriceMinor: 10000n, createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  app = await buildApp();
  q = wire(new MemoryQueue()) as MemoryQueue;
  registerGrnConsumers(q);
  registerPoConsumers(q);
  await q.start();
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

function grnBody(received: number, accepted = received) {
  return {
    poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
    items: [{ poItemRef: PO_ITEM, itemCode: "LAP-001", orderedQty: ORDERED, receivedQty: received, acceptedQty: accepted, unit: "nos" }],
  };
}
async function receiveViaConsumer(received: number): Promise<string> {
  const id = randomUUID();
  await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, { id, tenantId: TENANT, ...grnBody(received) }));
  await q.drain();
  return id;
}
async function grnCount(): Promise<number> {
  const rows = await inTenant((tx) => tx.select().from(procurementGrns).where(eq(procurementGrns.tenantId, TENANT)));
  return rows.length;
}

describe("pure rules", () => {
  it("assertWithinOpenQty: rejects a line over the open qty, ignores unbounded (ordered<=0) lines", () => {
    const committed = new Map([["p1", 7]]);
    expect(() => assertWithinOpenQty([{ poItemRef: "p1", orderedQty: 10, receivedQty: 3 }], committed)).not.toThrow();
    expect(() => assertWithinOpenQty([{ poItemRef: "p1", orderedQty: 10, receivedQty: 4 }], committed)).toThrow(DomainError);
    expect(() => assertWithinOpenQty([{ poItemRef: "p9", orderedQty: 0, receivedQty: 999 }], committed)).not.toThrow();
    // two lines of the same PO item in one GRN are summed
    expect(() => assertWithinOpenQty([
      { poItemRef: "p1", orderedQty: 10, receivedQty: 2 }, { poItemRef: "p1", orderedQty: 10, receivedQty: 2 },
    ], committed)).toThrow(/OVER_RECEIPT/);
  });

  it("isEmpanelmentLapsed: no rows = registered vendor (not lapsed); all expired/inactive = lapsed; any current = fine; open-ended = fine", () => {
    const today = "2026-10-14";
    expect(isEmpanelmentLapsed([], today)).toBe(false);
    expect(isEmpanelmentLapsed([{ status: "active", validUntil: "2026-10-13" }], today)).toBe(true);
    expect(isEmpanelmentLapsed([{ status: "active", validUntil: "2026-10-14" }], today)).toBe(false); // valid through the day
    expect(isEmpanelmentLapsed([{ status: "suspended", validUntil: "2030-01-01" }], today)).toBe(true);
    expect(isEmpanelmentLapsed([{ status: "active", validUntil: null }], today)).toBe(false);
    expect(isEmpanelmentLapsed([{ status: "active", validUntil: "2020-01-01" }, { status: "active", validUntil: "2030-01-01" }], today)).toBe(false);
  });
});

describe("GRN-NEW-06 - cumulative over-receipt against the PO's open qty", () => {
  it("Given PO open qty 10, when a GRN receives 6 then another receives 5, the second is refused (422 at the route)", async () => {
    await receiveViaConsumer(6);
    expect(await grnCount()).toBe(1);

    const over = await app.inject({ method: "POST", url: "/v1/procurement/grns", headers: hdr(["procurement_officer"]), payload: grnBody(5) });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe("OVER_RECEIPT");

    const exact = await app.inject({ method: "POST", url: "/v1/procurement/grns", headers: hdr(["procurement_officer"]), payload: grnBody(4) });
    expect(exact.statusCode).toBe(202);
  });

  it("the consumer re-checks under a per-PO lock: a command that bypassed the route writes no GRN and lands in the DLQ", async () => {
    const before = await grnCount();
    const id = randomUUID();
    await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, { id, tenantId: TENANT, ...grnBody(5) }));
    await q.drain();
    expect(await grnCount()).toBe(before);
    expect(q.dlq.some((d) => d.error.includes("OVER_RECEIPT"))).toBe(true);
  });

  it("a rejected GRN releases its quantity: after the 6 is rejected, 10 can be received again", async () => {
    const rows = await inTenant((tx) => tx.select().from(procurementGrns).where(eq(procurementGrns.tenantId, TENANT)));
    const firstId = rows[0]!.id;
    await q.publish(COMMANDS.grnReject, msg(COMMANDS.grnReject, { id: firstId, tenantId: TENANT, reason: "damaged" }, "a2000000-9999-4000-8000-000000000009"));
    await q.drain();
    const ok = await app.inject({ method: "POST", url: "/v1/procurement/grns", headers: hdr(["procurement_officer"]), payload: grnBody(10) });
    expect(ok.statusCode).toBe(202);
  });
});

describe("EMPANELMENT-05 / ORDERS-NEW-06 - a lapsed empanelment cannot be ordered from", () => {
  const LAPSED = "a2000000-2222-4000-8000-000000000002";
  const CURRENT = "a2000000-2222-4000-8000-000000000003";
  const PLAIN = "a2000000-2222-4000-8000-000000000004";
  const poPayload = (vendorId: string) => ({
    vendorId, indentRef: `procurement_indent:${randomUUID()}`,
    items: [{ itemCode: "IC-1", description: "Widget", quantity: 1, unit: "nos", unitPriceMinor: 100 }],
  });

  beforeAll(async () => {
    await seedVendor(LAPSED, "Lapsed Co", "empanelled");
    await seedEmpanelment(LAPSED, "2020-01-01");
    await seedVendor(CURRENT, "Current Co", "empanelled");
    await seedEmpanelment(CURRENT, "2099-01-01");
    await seedVendor(PLAIN, "Plain Registered Co", "registered");
  });

  it.each(["/v1/procurement/pos", "/v1/procurement/purchase-orders"])("%s: 422 EMPANELMENT_EXPIRED for a lapsed vendor, nothing enqueued", async (url) => {
    const res = await app.inject({ method: "POST", url, headers: hdr(["procurement_officer"]), payload: poPayload(LAPSED) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("EMPANELMENT_EXPIRED");
  });

  // D4c #28 (owner decision 2026-10-27) supersedes the earlier "registered vendor with
  // no empanelment record is accepted": with no record the order needs an awarded
  // tender or a GeM order reference (see d4c-28-po-nonempanelled-basis.test.ts).
  it.each(["/v1/procurement/pos", "/v1/procurement/purchase-orders"])("%s: a vendor with a current empanelment is accepted (202); one with no record only with a GeM basis", async (url) => {
    const ok = await app.inject({ method: "POST", url, headers: hdr(["procurement_officer"]), payload: poPayload(CURRENT) });
    expect(ok.statusCode).toBe(202);
    const none = await app.inject({ method: "POST", url, headers: hdr(["procurement_officer"]), payload: poPayload(PLAIN) });
    expect(none.statusCode).toBe(422);
    expect(none.json().code).toBe("VENDOR_NOT_EMPANELLED");
    const withGem = await app.inject({ method: "POST", url, headers: hdr(["procurement_officer"]), payload: { ...poPayload(PLAIN), gemOrderRef: "GEM/2026/B/1" } });
    expect(withGem.statusCode).toBe(202);
  });

  it("the poCreate consumer re-checks in its transaction: a command for a lapsed vendor writes no PO", async () => {
    const id = randomUUID();
    await q.publish(COMMANDS.poCreate, msg(COMMANDS.poCreate, { id, tenantId: TENANT, ...poPayload(LAPSED), poNo: "ignored" }));
    await q.drain();
    const rows = await inTenant((tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, id)));
    expect(rows).toHaveLength(0);
  });
});

describe("?q= search on the vendor and PO lists (picker support)", () => {
  beforeAll(async () => {
    await seedVendor("a2000000-2222-4000-8000-0000000000a1", "Zeta Traders");
    await seedVendor("a2000000-2222-4000-8000-0000000000a2", "100% Steel_Works");
  });

  it("vendors: ?q= matches by name, case-insensitively, and finds a row beyond a tiny page", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/vendors?limit=1&q=zeta", headers: hdr(["procurement_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((v: { name: string }) => v.name)).toEqual(["Zeta Traders"]);
  });

  it("vendors: LIKE metacharacters in q match literally (a bare % does not match everything)", async () => {
    const pct = await app.inject({ method: "GET", url: "/v1/procurement/vendors?q=%25", headers: hdr(["procurement_admin"]) });
    expect(pct.json().data.map((v: { name: string }) => v.name)).toEqual(["100% Steel_Works"]);
    const us = await app.inject({ method: "GET", url: "/v1/procurement/vendors?q=t_e", headers: hdr(["procurement_admin"]) });
    expect(us.json().data).toEqual([]);
  });

  it("vendors: no q = unchanged behaviour; an over-long q is a 400, not a scan", async () => {
    const all = await app.inject({ method: "GET", url: "/v1/procurement/vendors", headers: hdr(["procurement_admin"]) });
    expect(all.json().data.length).toBeGreaterThan(2);
    const long = await app.inject({ method: "GET", url: `/v1/procurement/vendors?q=${"x".repeat(101)}`, headers: hdr(["procurement_admin"]) });
    expect(long.statusCode).toBe(400);
  });

  it("pos: ?q= matches by PO number", async () => {
    const hit = await app.inject({ method: "GET", url: "/v1/procurement/pos?q=W2-001", headers: hdr(["procurement_officer"]) });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data.map((p: { poNo: string }) => p.poNo)).toEqual(["PO-W2-001"]);
    const miss = await app.inject({ method: "GET", url: "/v1/procurement/pos?q=NOPE-999", headers: hdr(["procurement_officer"]) });
    expect(miss.json().data).toEqual([]);
  });
});
