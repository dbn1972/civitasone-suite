/**
 * Req 1.2 — GRN partial-delivery amendment.
 *
 * Route-level: PATCH /v1/procurement/grns/:id validates auth/role/schema and
 * synchronously guards on amendability (409 GRN_NOT_AMENDABLE) before
 * publishing the command — mirrors the PO amendment route guard pattern.
 * Consumer-level: drives registerGrnConsumers() on a MemoryQueue against the
 * real Postgres test DB to confirm the line-quantity write actually lands.
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
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { registerGrnConsumers } from "../src/modules/grn/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9c900000-1111-4000-8000-000000000001";
const ACTOR  = "9c900000-2222-4000-8000-000000000002";
const VENDOR = "9c900000-3333-4000-8000-000000000001";

function tok(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-grn-amend" }, SECRET, 3600);
}

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }

async function seedGrn(
  id: string,
  status: string,
  lineId: string,
): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementGrns).values({
      id, tenantId: TENANT, grnNo: `GRN-AMEND-${id.slice(-4)}`,
      poRef: "procurement_po:seed", vendorId: VENDOR,
      receivedDate: "2026-01-01", threeWayMatch: false, status,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementGrnItems).values({
      id: lineId, grnId: id, tenantId: TENANT,
      poItemRef: "procurement_po_item:seed", itemCode: "LAP-001",
      orderedQty: 10, receivedQty: 5, acceptedQty: 5, unit: "nos",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
  }));
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("PATCH /v1/procurement/grns/:id — happy path (draft/under_inspection)", () => {
  const grnId = randomUUID();
  const lineId = randomUUID();

  it("returns 202 and the consumer writes the amended line quantities", async () => {
    await seedGrn(grnId, "draft", lineId);

    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${grnId}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { lines: [{ lineId, receivedQty: 8, acceptedQty: 7 }] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");

    // The route only publishes the command — drive the real consumer to
    // confirm the DB write, mirroring the rfq-create.test.ts pattern.
    const q = wire(new MemoryQueue());
    registerGrnConsumers(q);
    await q.start();
    await q.publish(COMMANDS.grnAmend, {
      messageId: randomUUID(), type: COMMANDS.grnAmend, tenantId: TENANT, actorId: ACTOR,
      correlationId: "corr-grn-amend-1", schemaVersion: "1.0",
      payload: { id: grnId, tenantId: TENANT, lines: [{ lineId, receivedQty: 8, acceptedQty: 7 }] },
    });
    await drain(q);

    const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.id, lineId))));
    expect(items[0]?.receivedQty).toBe(8);
    expect(items[0]?.acceptedQty).toBe(7);

    // grnNo, vendorId, poRef stay untouched by the amendment.
    const grn = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrns).where(eq(procurementGrns.id, grnId)))))[0];
    expect(grn?.grnNo).toBe(`GRN-AMEND-${grnId.slice(-4)}`);
    expect(grn?.vendorId).toBe(VENDOR);
    expect(grn?.poRef).toBe("procurement_po:seed");
  });

  it("also succeeds while status is under_inspection", async () => {
    const id = randomUUID();
    const line = randomUUID();
    await seedGrn(id, "under_inspection", line);

    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${id}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { lines: [{ lineId: line, receivedQty: 10, acceptedQty: 9 }] },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("PATCH /v1/procurement/grns/:id — 409 guard once accepted", () => {
  const grnId = randomUUID();
  const lineId = randomUUID();

  it("returns 409 GRN_NOT_AMENDABLE when the GRN is already accepted", async () => {
    await seedGrn(grnId, "accepted", lineId);

    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${grnId}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { lines: [{ lineId, receivedQty: 9, acceptedQty: 9 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("GRN_NOT_AMENDABLE");

    // The line quantities must be untouched.
    const items = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGrnItems).where(eq(procurementGrnItems.id, lineId))));
    expect(items[0]?.receivedQty).toBe(5);
    expect(items[0]?.acceptedQty).toBe(5);
  });

  it("returns 409 GRN_NOT_AMENDABLE when the GRN is rejected", async () => {
    const id = randomUUID();
    const line = randomUUID();
    await seedGrn(id, "rejected", line);

    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${id}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { lines: [{ lineId: line, receivedQty: 9, acceptedQty: 9 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("GRN_NOT_AMENDABLE");
  });
});

describe("PATCH /v1/procurement/grns/:id — route contract", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/procurement/grns/${randomUUID()}`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without procurement write access", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${randomUUID()}`,
      headers: { authorization: `Bearer ${tok(["citizen"])}`, "content-type": "application/json" },
      payload: { lines: [{ lineId: randomUUID(), receivedQty: 1, acceptedQty: 1 }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when lines is empty", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${randomUUID()}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { lines: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 404 for an unknown GRN id", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/grns/${randomUUID()}`,
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}`, "content-type": "application/json" },
      payload: { lines: [{ lineId: randomUUID(), receivedQty: 1, acceptedQty: 1 }] },
    });
    expect(res.statusCode).toBe(404);
  });
});
