/**
 * UAT DB-test defects (2026-10-28) — each case reproduces a defect found by the live UAT run and
 * proves the fix end to end (route -> queue -> consumer -> Postgres), not just a 202.
 *   1. PATCH /items/:id never applied (item id reused as messageId -> inbox dedupe)
 *   2. POST/PATCH /items dropped reorderMax, hsnCode, gstRate, taxClass, shelfLifeDays, tracking flags
 *   3. direct PATCH categories/uoms/stores: no audit/outbox row, stale list read-back
 *   4. cycle-count with a non-store warehouseId -> 202 then DLQ  => 422
 *   5. release of a missing reservation -> 202  => 404
 *   6. SRN for a non-accepted GRN -> 202 then consumer failure  => 409
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerItemConsumers } from "../src/modules/items/consumer.js";
import { registerStoreConsumers } from "../src/modules/stores/consumer.js";
import { items, categories, uoms, reservations } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d4d4d4d4-0000-4000-8000-000000007001";
const ACTOR = "d4d4d4d4-0000-4000-8000-aaaaaaaa7001";

const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["inventory_admin"], sid: "sess-uat" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
  "content-type": "application/json",
});
const drain = () => (queue as unknown as MemoryQueue).drain();
const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

function wireTenantAwareQueue(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function cleanup(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(reservations).where(eq(reservations.tenantId, TENANT));
    await tx.delete(items).where(eq(items.tenantId, TENANT));
    await tx.delete(categories).where(eq(categories.tenantId, TENANT));
    await tx.delete(uoms).where(eq(uoms.tenantId, TENANT));
    await tx.delete(stores).where(eq(stores.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  });
}

async function post(url: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: hdr(), payload: payload as object });
}
async function patch(url: string, payload: unknown) {
  return app.inject({ method: "PATCH", url, headers: hdr(), payload: payload as object });
}
const get = (url: string) => app.inject({ method: "GET", url, headers: hdr() });

const auditRows = async (resourceType: string, resourceId: string) =>
  (await inTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))))
    .filter((r) => r.eventType === "audit.event.record")
    .filter((r) => {
      const p = r.payload as Record<string, unknown>;
      return p.resourceType === resourceType && p.resourceId === resourceId && p.action === "update";
    });

let app: FastifyInstance;

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerItemConsumers(queue);
  registerStoreConsumers(queue);
  app = await buildApp();
  await cleanup();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });
beforeEach(async () => { vi.unstubAllGlobals(); await cleanup(); });

async function createItem(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/v1/inventory/items", { name: "UAT item", ...extra });
  expect(res.statusCode).toBe(202);
  await drain();
  return res.json().id as string;
}
async function createStore(): Promise<string> {
  const res = await post("/v1/inventory/stores", { name: "UAT store", code: `ST-${randomUUID().slice(0, 8)}` });
  expect(res.statusCode).toBe(202);
  await drain();
  return res.json().id as string;
}
const itemRow = async (id: string) =>
  (await inTenant((tx) => tx.select().from(items).where(eq(items.id, id))))[0]!;

describe("defect 1+2 — item create/update round trip", () => {
  it("POST /items persists every validated field", async () => {
    const id = await createItem({
      reorderLevel: 10, reorderQty: 20, reorderMax: 500, hsnCode: "4802", gstRate: "12.00",
      taxClass: "GOODS", shelfLifeDays: 365, requiresBatchTracking: true, requiresSerialTracking: true,
    });
    const row = await itemRow(id);
    expect(row).toMatchObject({
      reorderLevel: 10, reorderQty: 20, reorderMax: 500, hsnCode: "4802", taxClass: "GOODS",
      shelfLifeDays: 365, requiresBatchTracking: true, requiresSerialTracking: true,
    });
    expect(Number(row.gstRate)).toBe(12);
  });

  it("two consecutive PATCHes to the same item both apply (no inbox dedupe)", async () => {
    const id = await createItem();
    const r1 = await patch(`/v1/inventory/items/${id}`, { version: 1, name: "renamed once" });
    expect(r1.statusCode).toBe(202);
    await drain();
    expect((await itemRow(id)).name).toBe("renamed once");
    expect((await itemRow(id)).version).toBe(2);

    const r2 = await patch(`/v1/inventory/items/${id}`, {
      version: 2, name: "renamed twice", reorderMax: 900, hsnCode: "8471", gstRate: "18.00",
      taxClass: "IT", shelfLifeDays: 30, requiresBatchTracking: true, requiresSerialTracking: true,
    });
    expect(r2.statusCode).toBe(202);
    await drain();
    const row = await itemRow(id);
    expect(row).toMatchObject({
      name: "renamed twice", version: 3, reorderMax: 900, hsnCode: "8471", taxClass: "IT",
      shelfLifeDays: 30, requiresBatchTracking: true, requiresSerialTracking: true,
    });
    expect(Number(row.gstRate)).toBe(18);
  });
});

describe("defect 3 — direct PATCH of categories / uoms / stores", () => {
  it("category: audit outbox row + fresh list read-back", async () => {
    expect((await post("/v1/inventory/categories", { name: "Old cat", code: "C1" })).statusCode).toBe(202);
    await drain();
    const before = (await get("/v1/inventory/categories")).json().data as Array<{ id: string; name: string }>;
    const id = before[0]!.id; // also primes the list cache
    expect((await patch(`/v1/inventory/categories/${id}`, { name: "New cat" })).statusCode).toBe(200);
    const after = (await get("/v1/inventory/categories")).json().data as Array<{ id: string; name: string }>;
    expect(after.find((c) => c.id === id)?.name).toBe("New cat");
    expect(await auditRows("category", id)).toHaveLength(1);
  });

  it("uom: audit outbox row + fresh list read-back", async () => {
    expect((await post("/v1/inventory/uoms", { name: "Box", symbol: "bx" })).statusCode).toBe(202);
    await drain();
    const id = ((await get("/v1/inventory/uoms")).json().data as Array<{ id: string }>)[0]!.id;
    expect((await patch(`/v1/inventory/uoms/${id}`, { symbol: "BOX" })).statusCode).toBe(200);
    const after = (await get("/v1/inventory/uoms")).json().data as Array<{ id: string; symbol: string }>;
    expect(after.find((u) => u.id === id)?.symbol).toBe("BOX");
    expect(await auditRows("uom", id)).toHaveLength(1);
  });

  it("store: audit outbox row + fresh list read-back", async () => {
    const id = await createStore();
    await get("/v1/inventory/stores"); // prime cache
    expect((await patch(`/v1/inventory/stores/${id}`, { name: "Renamed store" })).statusCode).toBe(200);
    const after = (await get("/v1/inventory/stores")).json().data as Array<{ id: string; name: string }>;
    expect(after.find((s) => s.id === id)?.name).toBe("Renamed store");
    expect(await auditRows("store", id)).toHaveLength(1);
  });

  it("PATCH of a missing category -> 404", async () => {
    const res = await patch(`/v1/inventory/categories/${randomUUID()}`, { name: "x" });
    expect(res.statusCode).toBe(404);
  });
});

describe("defect 4 — cycle-count warehouseId must be a store", () => {
  it("unknown / non-store id -> 422 INVALID_STORE, nothing published", async () => {
    const itemId = await createItem();
    const res = await post("/v1/inventory/cycle-counts", {
      itemId, warehouseId: randomUUID(), physicalQty: 5, reasonCode: "COUNT",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error?.code ?? res.json().code).toBe("INVALID_STORE");
    expect((queue as unknown as MemoryQueue).dlq).toHaveLength(0);
  });

  it("a real store id is still accepted", async () => {
    const itemId = await createItem();
    const storeId = await createStore();
    const res = await post("/v1/inventory/cycle-counts", { itemId, warehouseId: storeId, physicalQty: 5, reasonCode: "COUNT" });
    expect(res.statusCode).toBe(202);
  });
});

describe("defect 5 — release of a reservation", () => {
  it("missing reservation -> 404", async () => {
    const res = await patch(`/v1/inventory/reservations/${randomUUID()}/release`, { version: 1 });
    expect(res.statusCode).toBe(404);
  });

  it("active -> 202 and released; releasing again -> 409", async () => {
    const itemId = await createItem();
    const storeId = await createStore();
    const created = await post("/v1/inventory/reservations", { itemId, storeId, qty: 1, refType: "PO", refId: randomUUID() });
    expect(created.statusCode).toBe(202);
    await drain();
    const id = created.json().id as string;
    expect((await patch(`/v1/inventory/reservations/${id}/release`, { version: 1 })).statusCode).toBe(202);
    await drain();
    expect((await patch(`/v1/inventory/reservations/${id}/release`, { version: 2 })).statusCode).toBe(409);
  });
});

describe("defect 6 — SRN requires an accepted GRN", () => {
  const stubGrn = (status: number, body?: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body ? JSON.stringify(body) : null, { status })));

  it("GRN not accepted -> 409 GRN_NOT_ACCEPTED", async () => {
    const grnId = randomUUID();
    stubGrn(200, { id: grnId, status: "pending_inspection" });
    const res = await post("/v1/inventory/srn", { grnId });
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code ?? res.json().code).toBe("GRN_NOT_ACCEPTED");
  });

  it("GRN missing -> 404 GRN_NOT_FOUND", async () => {
    stubGrn(404);
    expect((await post("/v1/inventory/srn", { grnId: randomUUID() })).statusCode).toBe(404);
  });

  it("GRN accepted -> 202", async () => {
    const grnId = randomUUID();
    stubGrn(200, { id: grnId, status: "accepted" });
    expect((await post("/v1/inventory/srn", { grnId })).statusCode).toBe(202);
  });
});
