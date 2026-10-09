/**
 * GAP-PROCUREMENT batch 3 backend tests:
 *  - GRN-NEW-01: grnNo is issued server-side from a gapless per-tenant/per-year
 *    sequence; any client-supplied grnNo is ignored, and concurrent creates get
 *    distinct sequential numbers.
 *  - GRN-NEW-04: POST /v1/procurement/grns returns 422 when the GRN's vendor
 *    does not match the referenced PO's vendor, and 404 when the PO is unknown.
 *  - GRN-DETAIL-02: GET /v1/procurement/grns/:id reports threeWayMatch as
 *    undefined while the GRN is still awaiting inspection, and a real boolean
 *    once inspected. It also exposes createdBy (GRN-DETAIL-03).
 *
 * Drives the real consumer on a MemoryQueue against the real Postgres test DB
 * and the real Fastify app for route-level assertions, mirroring
 * dom-002-grn-guards.test.ts / grn-amendment.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems, procurementInspections } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT    = "9e000000-1111-4000-8000-000000000001";
const RECEIVER  = "9e000000-2222-4000-8000-000000000001";
const INSPECTOR = "9e000000-3333-4000-8000-000000000001";
const VENDOR    = "9e000000-4444-4000-8000-000000000001";
const OTHER_VENDOR = "9e000000-4444-4000-8000-000000000099";
const PO_ID      = "9e000000-5555-4000-8000-000000000001";
const PO_ITEM_ID = "9e000000-6666-4000-8000-000000000001";
const ORDERED = 5;

function tok(roles: string[], actor = RECEIVER) {
  return signToken({ sub: actor, tid: TENANT, roles, sid: "sess-grn-b3" }, SECRET, 3600);
}
function hdr(roles: string[], actor = RECEIVER) {
  return { authorization: `Bearer ${tok(roles, actor)}`, "x-tenant-id": TENANT, "content-type": "application/json" };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
function msg(type: string, payload: Record<string, unknown>, actorId: string) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}

async function seedPo(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementPos).values({
      id: PO_ID, tenantId: TENANT, poNo: "PO-B3-001", vendorId: VENDOR,
      indentRef: "procurement_indent:seed", status: "approved", totalMinor: 50000n,
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
    await tx.insert(procurementPoItems).values({
      id: PO_ITEM_ID, poId: PO_ID, tenantId: TENANT, itemCode: "LAP-001", description: "Laptop",
      quantity: ORDERED, unit: "nos", unitPriceMinor: 10000n,
      createdBy: RECEIVER, updatedBy: RECEIVER,
    });
  }));
}
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementInspections).where(eq(procurementInspections.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

async function createViaFlow(q: MemoryQueue, actor = RECEIVER, clientGrnNo?: string): Promise<string> {
  const id = randomUUID();
  await q.publish(COMMANDS.grnCreate, msg(COMMANDS.grnCreate, {
    id, tenantId: TENANT, ...(clientGrnNo ? { grnNo: clientGrnNo } : {}),
    poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
    items: [{ poItemRef: PO_ITEM_ID, itemCode: "LAP-001", orderedQty: ORDERED, receivedQty: ORDERED, acceptedQty: ORDERED, unit: "nos" }],
  }, actor));
  await q.drain();
  return id;
}
async function getGrnRow(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementGrns).where(eq(procurementGrns.id, id))));
  return rows[0] ?? null;
}

let app: FastifyInstance;

beforeAll(async () => { await wipe(); await seedPo(); app = await buildApp(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GRN-NEW-01 — grnNo issued server-side (gapless sequence), client value ignored", () => {
  it("assigns a sequential GRN/<year>/#### number and ignores any client-supplied grnNo", async () => {
    const q = wire(new MemoryQueue()) as MemoryQueue;
    registerGrnConsumers(q);
    await q.start();

    const id1 = await createViaFlow(q, RECEIVER, "GRN/CLIENT/HACKED");
    const id2 = await createViaFlow(q, RECEIVER, "GRN/CLIENT/HACKED-2");

    const g1 = await getGrnRow(id1);
    const g2 = await getGrnRow(id2);
    const year = new Date().getUTCFullYear();
    expect(g1?.grnNo).toMatch(new RegExp(`^GRN/${year}/\\d{4}$`));
    expect(g2?.grnNo).toMatch(new RegExp(`^GRN/${year}/\\d{4}$`));
    // Client value never persisted; the two numbers are distinct and sequential.
    expect(g1?.grnNo).not.toContain("HACKED");
    const n1 = Number(g1!.grnNo.split("/").pop());
    const n2 = Number(g2!.grnNo.split("/").pop());
    expect(n2).toBe(n1 + 1);
  });
});

describe("GRN-NEW-04 — vendor must match the PO's vendor (route-level)", () => {
  it("returns 422 VENDOR_PO_MISMATCH when the GRN vendor differs from the PO's vendor", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/grns", headers: hdr(["procurement_officer"]),
      payload: {
        poRef: `procurement_po:${PO_ID}`, vendorId: OTHER_VENDOR,
        items: [{ poItemRef: PO_ITEM_ID, itemCode: "LAP-001", orderedQty: ORDERED, receivedQty: 1, acceptedQty: 1, unit: "nos" }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VENDOR_PO_MISMATCH");
  });

  it("returns 404 PO_NOT_FOUND when the referenced PO does not exist", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/grns", headers: hdr(["procurement_officer"]),
      payload: {
        poRef: "procurement_po:9e000000-0000-4000-8000-00000000dead", vendorId: VENDOR,
        items: [{ poItemRef: PO_ITEM_ID, itemCode: "LAP-001", orderedQty: ORDERED, receivedQty: 1, acceptedQty: 1, unit: "nos" }],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PO_NOT_FOUND");
  });

  it("accepts a GRN whose vendor matches the PO (control, 202)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/grns", headers: hdr(["procurement_officer"]),
      payload: {
        poRef: `procurement_po:${PO_ID}`, vendorId: VENDOR,
        items: [{ poItemRef: PO_ITEM_ID, itemCode: "LAP-001", orderedQty: ORDERED, receivedQty: 1, acceptedQty: 1, unit: "nos" }],
      },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("GRN-DETAIL-02 — GET reports match pending until inspected", () => {
  it("threeWayMatch is undefined before inspection and a boolean after; createdBy is exposed", async () => {
    const q = wire(new MemoryQueue()) as MemoryQueue;
    registerGrnConsumers(q);
    await q.start();

    const id = await createViaFlow(q);

    // Before inspection — read via the route.
    const before = await app.inject({ method: "GET", url: `/v1/procurement/grns/${id}`, headers: hdr(["procurement_officer"]) });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json();
    expect(beforeBody.threeWayMatch).toBeUndefined();
    expect(beforeBody.createdBy).toBe(RECEIVER);

    // Inspect (accept) as a distinct officer.
    await q.publish(COMMANDS.grnAccept, msg(COMMANDS.grnAccept, { id, tenantId: TENANT, remarks: "ok" }, INSPECTOR));
    await q.drain();

    const after = await app.inject({ method: "GET", url: `/v1/procurement/grns/${id}`, headers: hdr(["procurement_officer"]) });
    expect(after.json().threeWayMatch).toBe(true);
  });
});

describe("GRN-DETAIL-06 — opaque poRef resolved to the human PO number (GAP2-PROCUREMENT-GRN-DETAIL-06)", () => {
  it("GET detail exposes poId (bare uuid) and poNo (human number), not just the opaque composite", async () => {
    const q = wire(new MemoryQueue()) as MemoryQueue;
    registerGrnConsumers(q);
    await q.start();
    const id = await createViaFlow(q);

    const res = await app.inject({ method: "GET", url: `/v1/procurement/grns/${id}`, headers: hdr(["procurement_officer"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The raw composite is still carried for linking, but the resolved number
    // and bare id are now present (absent entirely on the old code).
    expect(body.poRef).toBe(`procurement_po:${PO_ID}`);
    expect(body.poId).toBe(PO_ID);
    expect(body.poNo).toBe("PO-B3-001");
  });

  it("GET list exposes poNo per row for the same resolution", async () => {
    const q = wire(new MemoryQueue()) as MemoryQueue;
    registerGrnConsumers(q);
    await q.start();
    const id = await createViaFlow(q);

    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns?limit=200", headers: hdr(["procurement_officer"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; poNo?: string; poId?: string }>;
    const row = rows.find((r) => r.id === id);
    expect(row?.poNo).toBe("PO-B3-001");
    expect(row?.poId).toBe(PO_ID);
  });
});
