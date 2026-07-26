/**
 * Batch/serial consumer — CQRS write-path round-trip integration tests (SVC-055).
 *
 * These tests prove the consumer that was previously MISSING actually persists:
 * they POST a command through the real HTTP route, drive the in-memory queue to
 * deliver it to the consumer, then GET through the read route and assert the row
 * was written to Postgres (not merely that the route returned 202).
 *
 * Covered write paths:
 *   1. batch.create   -> row persisted, readable by GET (lot/batch/mfg/expiry/qty)
 *   2. serial.register-> serial row persisted, unique-per-item enforced
 *   3. batch.issue    -> qty decremented; full issue -> status "depleted"
 *   4. batch.quarantine -> status "quarantine"
 *   5. batch.recall   -> status "recalled"
 *   6. idempotency    -> redelivered messageId does not double-apply
 *   7. RLS cross-tenant isolation -> tenant B cannot see tenant A's batch
 *
 * Validates: Requirements 14.5, 14.6 (SVC-055).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBatchConsumers } from "../src/modules/batches/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { items } from "../src/modules/items/schema.js";
import { batches, serialNumbers } from "../src/modules/batches/schema.js";
import { processed } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-0000-4000-8000-00000000c055";
const TENANT_B = "b2b2b2b2-0000-4000-8000-00000000c055";
const ACTOR_A  = "a1a1a1a1-0000-4000-8000-aaaaaaaaaaaa";
const ACTOR_B  = "b2b2b2b2-0000-4000-8000-bbbbbbbbbbbb";
const ITEM_A   = "cccccccc-0000-4000-8000-00000000c001";
const ITEM_B   = "cccccccc-0000-4000-8000-00000000c002";

function tokenFor(tenantId: string, actorId: string, roles = ["inventory_admin", "qc_inspector"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-b" }, SECRET, 3600);
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

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(serialNumbers).where(eq(serialNumbers.tenantId, t));
      await tx.delete(batches).where(eq(batches.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
    }));
  }
}

async function seedItems(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.insert(items).values({
      id: ITEM_A, tenantId: TENANT_A, name: "Vaccine Vial", sku: "VAC-A",
      reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_A, updatedBy: ACTOR_A,
    }).onConflictDoNothing();
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.insert(items).values({
      id: ITEM_B, tenantId: TENANT_B, name: "Vaccine Vial B", sku: "VAC-B",
      reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_B, updatedBy: ACTOR_B,
    }).onConflictDoNothing();
  }));
}

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerBatchConsumers(queue);
  app = await buildApp();
  await cleanup();
  await seedItems();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function createBatch(batchNumber: string, expiryDate: string, qty: number): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/inventory/batches", headers: hdr(TENANT_A, ACTOR_A),
    payload: { itemId: ITEM_A, batchNumber, mfgDate: "2026-01-01", expiryDate, qty },
  });
  expect(res.statusCode).toBe(202);
  await drain();
  return res.json().id as string;
}

describe("batch consumer — create round-trip (persists, not just 202)", () => {
  it("POST batch.create -> consumer persists -> GET returns the row", async () => {
    const id = await createBatch("LOT-CREATE-001", "2027-12-31", 500);

    const get = await app.inject({
      method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_A, ACTOR_A),
    });
    expect(get.statusCode).toBe(200);
    const b = get.json().data;
    expect(b.id).toBe(id);
    expect(b.batchNumber).toBe("LOT-CREATE-001");
    expect(b.qty).toBe(500);
    expect(b.status).toBe("active");
    expect(b.expiryDate).toBe("2027-12-31");

    // DB-level assertion (bypasses cache): row physically exists.
    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(batches).where(eq(batches.id, id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(500);
  });
});

describe("serial consumer — register round-trip + uniqueness", () => {
  it("POST serial.register -> consumer persists -> GET lists it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/serials", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A, serialNumber: "SN-RT-0001" },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await drain();

    const get = await app.inject({
      method: "GET", url: `/v1/inventory/serials/${id}`, headers: hdr(TENANT_A, ACTOR_A),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.serialNumber).toBe("SN-RT-0001");
    expect(get.json().data.status).toBe("available");
  });

  it("duplicate serial for same item is rejected by the consumer (no 2nd row)", async () => {
    await app.inject({
      method: "POST", url: "/v1/inventory/serials", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A, serialNumber: "SN-DUP-0001" },
    });
    await drain();
    await app.inject({
      method: "POST", url: "/v1/inventory/serials", headers: hdr(TENANT_A, ACTOR_A),
      payload: { itemId: ITEM_A, serialNumber: "SN-DUP-0001" },
    });
    await drain();

    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(serialNumbers).where(eq(serialNumbers.serialNumber, "SN-DUP-0001"))));
    expect(rows).toHaveLength(1);
  });
});

describe("batch consumer — issue decrements on-hand (expiry/qty guarded)", () => {
  it("partial issue decrements qty; full issue depletes the batch", async () => {
    const id = await createBatch("LOT-ISSUE-001", "2027-12-31", 100);

    // Partial issue of 40 -> 60 remaining
    const r1 = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue", headers: hdr(TENANT_A, ACTOR_A),
      payload: { batchId: id, qty: 40, postingDate: "2026-02-01" },
    });
    expect(r1.statusCode).toBe(202);
    await drain();

    let b = (await app.inject({ method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_A, ACTOR_A) })).json().data;
    expect(b.qty).toBe(60);
    expect(b.status).toBe("active");

    // Issue the remaining 60 -> depleted
    const r2 = await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue", headers: hdr(TENANT_A, ACTOR_A),
      payload: { batchId: id, qty: 60, postingDate: "2026-02-02" },
    });
    expect(r2.statusCode).toBe(202);
    await drain();

    b = (await app.inject({ method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_A, ACTOR_A) })).json().data;
    expect(b.qty).toBe(0);
    expect(b.status).toBe("depleted");
  });

  it("over-issue is rejected by the consumer (qty unchanged)", async () => {
    const id = await createBatch("LOT-ISSUE-002", "2027-12-31", 10);
    await app.inject({
      method: "POST", url: "/v1/inventory/batches/issue", headers: hdr(TENANT_A, ACTOR_A),
      payload: { batchId: id, qty: 999, postingDate: "2026-02-01" },
    });
    await drain();
    const b = (await app.inject({ method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_A, ACTOR_A) })).json().data;
    expect(b.qty).toBe(10);
  });
});

describe("batch consumer — quarantine & recall status transitions", () => {
  it("PATCH quarantine -> consumer sets status 'quarantine'", async () => {
    const id = await createBatch("LOT-QTN-001", "2027-12-31", 200);
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/batches/${id}/quarantine`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { reason: "temperature excursion detected" },
    });
    expect(res.statusCode).toBe(202);
    await drain();
    const b = (await app.inject({ method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_A, ACTOR_A) })).json().data;
    expect(b.status).toBe("quarantine");
  });

  it("POST recall -> consumer sets status 'recalled'", async () => {
    const id = await createBatch("LOT-RCL-001", "2027-12-31", 200);
    const res = await app.inject({
      method: "POST", url: `/v1/inventory/batches/${id}/recall`, headers: hdr(TENANT_A, ACTOR_A),
      payload: { reason: "contamination", severity: "critical" },
    });
    expect(res.statusCode).toBe(202);
    await drain();
    const b = (await app.inject({ method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_A, ACTOR_A) })).json().data;
    expect(b.status).toBe("recalled");
  });
});

describe("batch consumer — idempotency", () => {
  it("redelivering the same batch.create messageId does not double-apply", async () => {
    const id = await createBatch("LOT-IDEM-001", "2027-12-31", 300);
    // Redeliver the SAME messageId + payload directly on the queue.
    await queue.publish(COMMANDS.batchCreate, {
      messageId: id, type: COMMANDS.batchCreate, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: "corr-idem", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT_A, itemId: ITEM_A, batchNumber: "LOT-IDEM-001", mfgDate: "2026-01-01", expiryDate: "2027-12-31", qty: 300 },
    });
    await drain();
    const rows = await runWithTenant(TENANT_A, () => db.transaction(async (tx) =>
      tx.select().from(batches).where(eq(batches.id, id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(300);
  });
});

describe("batch consumer — RLS cross-tenant isolation", () => {
  it("tenant B cannot read tenant A's persisted batch (404)", async () => {
    const id = await createBatch("LOT-RLS-001", "2027-12-31", 77);

    const asB = await app.inject({
      method: "GET", url: `/v1/inventory/batches/${id}`, headers: hdr(TENANT_B, ACTOR_B, ["inventory_admin"]),
    });
    expect(asB.statusCode).toBe(404);

    // And a raw tenant-B scoped read returns zero rows (RLS-enforced).
    const leaked = await runWithTenant(TENANT_B, () => db.transaction(async (tx) =>
      tx.select().from(batches).where(eq(batches.id, id))));
    expect(leaked).toHaveLength(0);
  });
});
