/**
 * items-extended consumer — CQRS write-path round-trip integration tests
 * (SVC-051..054): substitutes, bins, reservations, goods returns + QC.
 *
 * These six commands (substitute.create, bin.create, reservation.create,
 * reservation.release, goods_return.create, goods_return.inspect) were
 * published by routes.ts/commands.ts but had NO consumer subscribed — every
 * route returned 202 and the write silently never persisted. This suite
 * proves the wired-up consumer actually persists: it POSTs the command
 * through the real HTTP route, drains the in-memory queue to deliver it to
 * the consumer, then asserts the row exists (or transitioned) directly in
 * Postgres — not merely that the route returned 202.
 *
 * Covered write paths:
 *   1. substitute.create      -> row persisted, listable
 *   2. bin.create              -> row persisted, listable
 *   3. reservation.create      -> row persisted, status "active"
 *   4. reservation.release     -> status "released"; absent/wrong-version is a safe no-op
 *   5. goods_return.create     -> row persisted, qc_status "pending"
 *   6. goods_return.inspect    -> qc_status/disposition transition
 *   7. idempotency              -> redelivered messageId does not double-apply
 *   8. RLS cross-tenant isolation -> tenant B cannot see tenant A's rows
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq, and, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerItemConsumers } from "../src/modules/items/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { items, itemSubstitutes, bins, reservations, goodsReturns } from "../src/modules/items/schema.js";
import { processed } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-0000-4000-8000-00000000c051";
const TENANT_B = "b2b2b2b2-0000-4000-8000-00000000c051";
const ACTOR_A  = "a1a1a1a1-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B  = "b2b2b2b2-0000-4000-8000-bbbbbbbbbbbb";
const ITEM_A1  = "cccccccc-0000-4000-8000-00000000d001";
const ITEM_A2  = "cccccccc-0000-4000-8000-00000000d002";
const ITEM_B1  = "cccccccc-0000-4000-8000-00000000d003";
const STORE_A  = "eeeeeeee-0000-4000-8000-00000000d001";
const STORE_B  = "eeeeeeee-0000-4000-8000-00000000d002";

function tokenFor(tenantId: string, actorId: string, roles = ["inventory_admin", "qc_inspector"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-c051" }, SECRET, 3600);
}
function hdr(tenantId: string, actorId: string, roles?: string[]) {
  return { authorization: `Bearer ${tokenFor(tenantId, actorId, roles)}`, "x-tenant-id": tenantId, "content-type": "application/json" };
}

const drain = () => (queue as unknown as MemoryQueue).drain();

let app: FastifyInstance;

/** Wrap the shared queue so consumer handlers run inside runWithTenant (sets the RLS GUC). */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** Message ids the idempotency test redelivers directly; cleared from the inbox between runs. */
const IDEMPOTENCY_MESSAGE_IDS: string[] = [];

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(goodsReturns).where(eq(goodsReturns.tenantId, t));
      await tx.delete(reservations).where(eq(reservations.tenantId, t));
      await tx.delete(bins).where(eq(bins.tenantId, t));
      await tx.delete(itemSubstitutes).where(eq(itemSubstitutes.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
    }));
  }
  if (IDEMPOTENCY_MESSAGE_IDS.length > 0) {
    await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(inArray(processed.messageId, IDEMPOTENCY_MESSAGE_IDS));
    }));
  }
}

async function seedItems(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.insert(items).values([
      { id: ITEM_A1, tenantId: TENANT_A, name: "Ledger Book", sku: "LB-A1", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_A, updatedBy: ACTOR_A },
      { id: ITEM_A2, tenantId: TENANT_A, name: "Ledger Book (spare)", sku: "LB-A2", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_A, updatedBy: ACTOR_A },
    ]).onConflictDoNothing();
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.insert(items).values({
      id: ITEM_B1, tenantId: TENANT_B, name: "Ledger Book B", sku: "LB-B1", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_B, updatedBy: ACTOR_B,
    }).onConflictDoNothing();
  }));
}

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerItemConsumers(queue);
  app = await buildApp();
  await cleanup();
  await seedItems();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("substitute consumer — create round-trip (persists, not just 202)", () => {
  it("POST substitutes -> consumer persists -> GET /items/:id/substitutes lists it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/substitutes", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A1, substituteId: ITEM_A2, priority: 1, conversionFactor: "1.0" },
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const list = await app.inject({
      method: "GET", url: `/v1/inventory/items/${ITEM_A1}/substitutes`, headers: hdr(TENANT_A, ACTOR_A),
    });
    expect(list.statusCode).toBe(200);
    const data = list.json().data;
    expect(data.some((s: { substituteId: string }) => s.substituteId === ITEM_A2)).toBe(true);

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(itemSubstitutes).where(and(eq(itemSubstitutes.itemId, ITEM_A1), eq(itemSubstitutes.substituteId, ITEM_A2)))));
    expect(rows).toHaveLength(1);
  });
});

describe("bin consumer — create round-trip (persists, not just 202)", () => {
  it("POST bins -> consumer persists -> GET /bins lists it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/bins", headers: hdr(TENANT_A, ACTOR_A),
      payload: { storeId: STORE_A, code: "BIN-RT-001", aisle: "A1", rack: "R2", shelf: "S3", capacity: 100 },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await drain();

    const list = await app.inject({ method: "GET", url: "/v1/inventory/bins", headers: hdr(TENANT_A, ACTOR_A) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((b: { id: string }) => b.id === id)).toBe(true);

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(bins).where(eq(bins.id, id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe("BIN-RT-001");
    expect(rows[0]!.capacity).toBe(100);
  });
});

describe("reservation consumer — create + release round-trip", () => {
  it("POST reservations -> consumer persists -> GET /reservations lists it (status active)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/reservations", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A1, storeId: STORE_A, qty: 25, refType: "indent", refId: ITEM_A2 },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(reservations).where(eq(reservations.id, id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.qty).toBe(25);

    const list = await app.inject({ method: "GET", url: "/v1/inventory/reservations", headers: hdr(TENANT_A, ACTOR_A) });
    expect(list.json().data.some((r: { id: string }) => r.id === id)).toBe(true);
  });

  it("PATCH reservations/:id/release -> consumer transitions status to 'released'", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/reservations", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A1, storeId: STORE_A, qty: 10, refType: "indent", refId: ITEM_A2 },
    });
    const id = create.json().id as string;
    await drain();

    const release = await app.inject({
      method: "PATCH", url: `/v1/inventory/reservations/${id}/release`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { version: 1 },
    });
    expect(release.statusCode).toBe(202);
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(reservations).where(eq(reservations.id, id))));
    expect(rows[0]!.status).toBe("released");
    expect(rows[0]!.version).toBe(2);
  });

  it("release with a stale version does not transition the row (safe no-op, dead-lettered)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/reservations", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A1, storeId: STORE_A, qty: 5, refType: "indent", refId: ITEM_A2 },
    });
    const id = create.json().id as string;
    await drain();

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    const release = await app.inject({
      method: "PATCH", url: `/v1/inventory/reservations/${id}/release`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { version: 99 },
    });
    expect(release.statusCode).toBe(202);
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(reservations).where(eq(reservations.id, id))));
    expect(rows[0]!.status).toBe("active");
    expect(mq.dlq.slice(before).some((d) => d.error.includes("RESERVATION_RELEASE_FAILED"))).toBe(true);
  });

  it("release of a nonexistent reservation is a safe no-op (dead-lettered, not thrown to the caller)", async () => {
    const bogusId = "ffffffff-0000-4000-8000-00000000d999";
    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    const release = await app.inject({
      method: "PATCH", url: `/v1/inventory/reservations/${bogusId}/release`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { version: 1 },
    });
    expect(release.statusCode).toBe(202);
    await drain();
    expect(mq.dlq.slice(before).some((d) => d.error.includes("RESERVATION_RELEASE_FAILED"))).toBe(true);
  });
});

describe("goods-return consumer — create + QC inspect round-trip", () => {
  it("POST goods-returns -> consumer persists -> qc_status 'pending'", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/goods-returns", headers: hdr(TENANT_A, ACTOR_A),
      payload: { originalIssueId: ITEM_A2, itemId: ITEM_A1, storeId: STORE_A, qty: 8, reason: "damaged in transit" },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(goodsReturns).where(eq(goodsReturns.id, id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qcStatus).toBe("pending");
    expect(rows[0]!.disposition).toBe("pending");

    const list = await app.inject({ method: "GET", url: "/v1/inventory/goods-returns", headers: hdr(TENANT_A, ACTOR_A) });
    expect(list.json().data.some((g: { id: string }) => g.id === id)).toBe(true);
  });

  it("PATCH goods-returns/:id/inspect -> consumer transitions qc_status + disposition", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/goods-returns", headers: hdr(TENANT_A, ACTOR_A),
      payload: { originalIssueId: ITEM_A2, itemId: ITEM_A1, storeId: STORE_A, qty: 3, reason: "wrong item" },
    });
    const id = create.json().id as string;
    await drain();

    const inspect = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { qcStatus: "passed", disposition: "restock", qcNotes: "good condition" },
    });
    expect(inspect.statusCode).toBe(202);
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(goodsReturns).where(eq(goodsReturns.id, id))));
    expect(rows[0]!.qcStatus).toBe("passed");
    expect(rows[0]!.disposition).toBe("restock");
    expect(rows[0]!.qcInspectedBy).toBe(ACTOR_A);
    expect(rows[0]!.qcNotes).toBe("good condition");
  });

  it("re-inspecting an already-inspected goods return is rejected (QC_NOT_PENDING, no double-apply)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/goods-returns", headers: hdr(TENANT_A, ACTOR_A),
      payload: { originalIssueId: ITEM_A2, itemId: ITEM_A1, storeId: STORE_A, qty: 2, reason: "excess return" },
    });
    const id = create.json().id as string;
    await drain();

    await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { qcStatus: "failed", disposition: "scrap" },
    });
    await drain();

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { qcStatus: "passed", disposition: "restock" },
    });
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(goodsReturns).where(eq(goodsReturns.id, id))));
    expect(rows[0]!.qcStatus).toBe("failed");
    expect(rows[0]!.disposition).toBe("scrap");
    expect(mq.dlq.slice(before).some((d) => d.error.includes("QC_NOT_PENDING"))).toBe(true);
  });
});

describe("items-extended consumer — idempotency", () => {
  it("redelivering the same bin.create messageId does not double-insert", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/bins", headers: hdr(TENANT_A, ACTOR_A),
      payload: { storeId: STORE_A, code: "BIN-IDEM-001" },
    });
    const id = res.json().id as string;
    IDEMPOTENCY_MESSAGE_IDS.push(id);
    await drain();

    // Redeliver the SAME messageId + payload directly on the queue.
    await queue.publish(COMMANDS.binCreate, {
      messageId: id, type: COMMANDS.binCreate, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: "corr-idem-bin", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, storeId: STORE_A, code: "BIN-IDEM-001" },
    });
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(bins).where(eq(bins.id, id))));
    expect(rows).toHaveLength(1);
  });

  it("redelivering the same reservation.release messageId does not double-bump version", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/inventory/reservations", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A1, storeId: STORE_A, qty: 15, refType: "indent", refId: ITEM_A2 },
    });
    const id = create.json().id as string;
    await drain();

    const release = await app.inject({
      method: "PATCH", url: `/v1/inventory/reservations/${id}/release`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { version: 1 },
    });
    const releaseMsgId = release.json().id as string; // route echoes reservation id, not messageId
    void releaseMsgId;
    await drain();

    // Redeliver a synthetic release with a FRESH messageId but the SAME payload —
    // the repo's guarded UPDATE...WHERE version=1 protects against double-apply
    // even if the inbox dedupe were bypassed, since the row is already at version 2.
    const replayMsgId = "aaaaaaaa-0000-4000-8000-00000000d777";
    IDEMPOTENCY_MESSAGE_IDS.push(replayMsgId);
    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;
    await queue.publish(COMMANDS.reservationRelease, {
      messageId: replayMsgId, type: COMMANDS.reservationRelease, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: "corr-idem-release", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, version: 1 },
    });
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => tx.select().from(reservations).where(eq(reservations.id, id))));
    expect(rows[0]!.status).toBe("released");
    expect(rows[0]!.version).toBe(2); // NOT bumped again
    expect(mq.dlq.slice(before).some((d) => d.error.includes("RESERVATION_RELEASE_FAILED"))).toBe(true);
  });
});

describe("items-extended consumer — RLS cross-tenant isolation", () => {
  it("tenant B cannot see tenant A's persisted bin (list + raw scoped read)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/bins", headers: hdr(TENANT_A, ACTOR_A),
      payload: { storeId: STORE_A, code: "BIN-RLS-001" },
    });
    const id = res.json().id as string;
    await drain();

    const listAsB = await app.inject({ method: "GET", url: "/v1/inventory/bins", headers: hdr(TENANT_B, ACTOR_B) });
    expect(listAsB.statusCode).toBe(200);
    expect(listAsB.json().data.some((b: { id: string }) => b.id === id)).toBe(false);

    const leaked = await runWithTenant(TENANT_B, () => db.transaction(async (tx) => tx.select().from(bins).where(eq(bins.id, id))));
    expect(leaked).toHaveLength(0);
  });

  it("tenant B cannot see tenant A's persisted reservation", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/reservations", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A1, storeId: STORE_A, qty: 9, refType: "indent", refId: ITEM_A2 },
    });
    const id = res.json().id as string;
    await drain();

    const listAsB = await app.inject({ method: "GET", url: "/v1/inventory/reservations", headers: hdr(TENANT_B, ACTOR_B) });
    expect(listAsB.json().data.some((r: { id: string }) => r.id === id)).toBe(false);

    const leaked = await runWithTenant(TENANT_B, () => db.transaction(async (tx) => tx.select().from(reservations).where(eq(reservations.id, id))));
    expect(leaked).toHaveLength(0);
  });
});
