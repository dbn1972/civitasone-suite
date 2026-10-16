/**
 * POST /v1/procurement/rfqs — queue-first CQRS create (mirrors indent create).
 *
 * Route-level: validates auth/role/schema and returns 202 + {id} without
 * touching the DB synchronously (command is only published to the queue).
 * Consumer-level: drives registerRfqConsumers() on a MemoryQueue against the
 * real Postgres test DB — the authoritative gapless rfqNo, vendorsInvited
 * count, item rows, and "issued" status are all consumer-side effects.
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
import { procurementRfqs, procurementRfqItems } from "../src/modules/rfq/schema.js";
import { registerRfqConsumers } from "../src/modules/rfq/consumer.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9b900000-1111-4000-8000-000000000001";
const ACTOR  = "9b900000-2222-4000-8000-000000000002";
const VENDOR_1 = "9b900000-3333-4000-8000-000000000001";
const VENDOR_2 = "9b900000-3333-4000-8000-000000000002";

function tok(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-rfq" }, SECRET, 3600);
}

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 300)); await q.stop(); }

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementRfqItems).where(eq(procurementRfqItems.tenantId, TENANT));
    await tx.delete(procurementRfqs).where(eq(procurementRfqs.tenantId, TENANT));
  }));
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("POST /v1/procurement/rfqs — route contract", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/rfqs", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without procurement write access", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/rfqs",
      headers: { authorization: `Bearer ${tok(["citizen"])}`, "content-type": "application/json" },
      payload: { title: "Should be rejected", closingDate: "2026-12-01", vendorIds: [VENDOR_1] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when vendorIds is empty (at least one invited vendor required)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/rfqs",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { title: "No vendors", closingDate: "2026-12-01", vendorIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when title is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/rfqs",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { closingDate: "2026-12-01", vendorIds: [VENDOR_1] },
    });
    expect(res.statusCode).toBe(400);
  });

  async function seedVendors(ids: string[]): Promise<void> {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(procurementVendors).values(ids.map((id, n) => ({
        id, tenantId: TENANT, name: `RFQ Test Vendor ${n}`, createdBy: ACTOR, updatedBy: ACTOR,
      })));
    }));
  }
  async function dropVendors(): Promise<void> {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
    }));
  }
  const post = (payload: Record<string, unknown>) => app.inject({
    method: "POST", url: "/v1/procurement/rfqs",
    headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
    payload: { title: "Min-vendor rule", closingDate: "2026-12-01", ...payload },
  });

  // GAP-PROCUREMENT-RFQ-NEW-02: GFR limited tender needs >= 3 vendors, enforced
  // by the server (the web form is only a convenience).
  it("RFQ-NEW-02: rejects 2 invited vendors without a justification (422 RFQ_MIN_VENDORS)", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    await seedVendors([a, b]);
    try {
      const res = await post({ vendorIds: [a, b] });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("RFQ_MIN_VENDORS");
      // A repeated id must not pad the count up to the minimum.
      const padded = await post({ vendorIds: [a, a, b, b] });
      expect(padded.statusCode).toBe(422);
    } finally { await dropVendors(); }
  });

  it("RFQ-NEW-02: accepts fewer than 3 with a written justification, and 3 without one", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await seedVendors(ids);
    try {
      const justified = await post({ vendorIds: ids.slice(0, 1), fewerVendorsJustification: "Sole empanelled source for this item." });
      expect(justified.statusCode).toBe(202);
      const blankJustification = await post({ vendorIds: ids.slice(0, 2), fewerVendorsJustification: "   " });
      expect(blankJustification.statusCode).toBe(422);
      const three = await post({ vendorIds: ids });
      expect(three.statusCode).toBe(202);
    } finally { await dropVendors(); }
  });

  it("RFQ-NEW-02: rejects an invited vendor that does not exist in this tenant (422 VENDOR_NOT_FOUND)", async () => {
    const res = await post({ vendorIds: [randomUUID(), randomUUID(), randomUUID()] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VENDOR_NOT_FOUND");
  });

  it("returns 202 with an accepted id for a valid RFQ create request", async () => {
    const ids = [VENDOR_1, VENDOR_2, "9b900000-3333-4000-8000-000000000003"];
    await seedVendors(ids);
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/rfqs",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: {
        rfqNo: "CLIENT-SUPPLIED-IGNORED",
        title: "Supply of laptops", closingDate: "2026-12-01",
        vendorIds: ids,
        items: [{ itemName: "Laptop 14-inch", quantity: 20, unit: "nos" }],
      },
    });
    await dropVendors();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });
});

describe("procurement.rfq.create consumer — gapless numbering + items + vendor count", () => {
  it("allocates a server-generated RFQ number, records vendorsInvited, and inserts line items", async () => {
    const id = randomUUID();
    const q = wire(new MemoryQueue());
    registerRfqConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rfqCreate, {
      messageId: randomUUID(), type: COMMANDS.rfqCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: "corr-rfq-1", schemaVersion: "1.0",
      payload: {
        id, tenantId: TENANT,
        rfqNo: "CLIENT-SUPPLIED-IGNORED",
        title: "Supply of laptops",
        indentRef: "procurement_indent:abc",
        closingDate: "2026-12-01",
        vendorIds: [VENDOR_1, VENDOR_2],
        items: [
          { itemName: "Laptop 14-inch", quantity: 20, unit: "nos" },
          { itemName: "Docking station", quantity: 20, unit: "nos" },
        ],
      },
    });
    await drain(q);

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementRfqs).where(eq(procurementRfqs.id, id))));
    const rfq = rows[0];
    expect(rfq).toBeDefined();
    // Gapless server-generated number (#12) — the client-supplied rfqNo is ignored.
    expect(rfq!.rfqNo).not.toBe("CLIENT-SUPPLIED-IGNORED");
    expect(rfq!.rfqNo).toMatch(/^RFQ\//);
    expect(rfq!.title).toBe("Supply of laptops");
    expect(rfq!.vendorsInvited).toBe(2);
    expect(rfq!.responsesReceived).toBe(0);
    expect(rfq!.status).toBe("issued");

    const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementRfqItems).where(eq(procurementRfqItems.rfqId, id))));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.itemName).sort()).toEqual(["Docking station", "Laptop 14-inch"]);
  });

  it("is idempotent — redelivering the same messageId does not create a duplicate RFQ", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    const publish = () => ({
      messageId, type: COMMANDS.rfqCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: "corr-rfq-2", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, title: "Duplicate check", closingDate: "2026-12-01", vendorIds: [VENDOR_1] },
    });

    const q1 = wire(new MemoryQueue()); registerRfqConsumers(q1); await q1.start();
    await q1.publish(COMMANDS.rfqCreate, publish());
    await drain(q1);

    const q2 = wire(new MemoryQueue()); registerRfqConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.rfqCreate, publish());
    await drain(q2);

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementRfqs).where(eq(procurementRfqs.id, id))));
    expect(rows).toHaveLength(1);
  });
});

describe("GET /v1/procurement/rfqs/:id — reflects consumer-created RFQ", () => {
  it("returns the RFQ created by the consumer above", async () => {
    const id = randomUUID();
    const q = wire(new MemoryQueue()); registerRfqConsumers(q); await q.start();
    await q.publish(COMMANDS.rfqCreate, {
      messageId: randomUUID(), type: COMMANDS.rfqCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: "corr-rfq-3", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, title: "Route readback check", closingDate: "2026-12-01", vendorIds: [VENDOR_1] },
    });
    await drain(q);

    const res = await app.inject({
      method: "GET", url: `/v1/procurement/rfqs/${id}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Route readback check");
    expect(body.vendorsInvited).toBe(1);
  });
});
