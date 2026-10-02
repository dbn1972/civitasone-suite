/**
 * movements consumer — NonRetryableError + GET-by-id regression coverage.
 *
 * A deterministic domain rejection (INSUFFICIENT_STOCK from
 * assertSufficientStock — an issue/transfer that overissues stock) used to
 * propagate as a plain Error, so the bus retried it maxAttempts (5) times
 * with exponential backoff before finally dead-lettering it: pure wasted
 * work for a rejection retrying could never fix. batches/items/srn already
 * wrap DomainError as NonRetryableError for exactly this reason; movements
 * did not. Compounding it, movements had no GET-by-id endpoint at all, so
 * the original requester had no way to ever learn a command was rejected.
 *
 * This suite proves both fixes end to end (real Postgres + the real
 * in-memory bus, not a unit-level mock of the retry loop):
 *
 *   1. An overissue on issue.create / transfer.create dead-letters on the
 *      FIRST delivery attempt — the handler runs once, not five times — and
 *      drain() (which awaits the full retry/backoff loop) returns quickly
 *      instead of after >=300ms of backoff sleeps.
 *   2. GET /v1/inventory/movements/:id lets the caller confirm the outcome:
 *      404 for the rejected id (the whole transaction, including the header
 *      insert, rolled back — nothing was ever persisted), 200 with the
 *      posted row for a legitimate movement.
 *   3. A genuinely sufficient issue is unaffected by the fix: it still
 *      succeeds on the first attempt, still decrements the balance, and is
 *      still retryable in principle (the catch only special-cases
 *      DomainError; anything else is rethrown unchanged).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler, CommandEnvelope } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import { items } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { movements, stockBalances, stockLedger } from "../src/modules/movements/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_M = "d1d1d1d1-0000-4000-8000-00000000d001";
const ACTOR_M  = "d1d1d1d1-0000-4000-8000-00000000d002";
const ITEM_OVERISSUE   = "eeeeeeee-0000-4000-8000-00000000d101";
const ITEM_LEGITIMATE  = "eeeeeeee-0000-4000-8000-00000000d102";
const ITEM_TRANSFER    = "eeeeeeee-0000-4000-8000-00000000d103";
const STORE_1 = "ffffffff-0000-4000-8000-00000000d201";
const STORE_2 = "ffffffff-0000-4000-8000-00000000d202";

function tokenFor(tenantId: string, actorId: string, roles = ["inventory_admin"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-movements-dlq" }, SECRET, 3600);
}
function hdr(tenantId: string, actorId: string, roles?: string[]) {
  return { authorization: `Bearer ${tokenFor(tenantId, actorId, roles)}`, "x-tenant-id": tenantId, "content-type": "application/json" };
}

const drain = () => (queue as unknown as MemoryQueue).drain();

/** Wrap subscribe so consumer handlers run inside runWithTenant (sets the RLS GUC) — same technique items-extended-consumer.test.ts uses. */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/**
 * Per-messageId delivery-attempt counter. Since a command's messageId IS the
 * resulting movement's id (see commands.ts: `publish(type, ctx, id, {id, ...})`),
 * this is the direct proof the fix removes wasted retries: before the fix an
 * overissue's handler ran up to 5 times (once per maxAttempts) before
 * dead-lettering; after the fix it runs exactly once.
 */
const attemptCounts = new Map<string, number>();
function countingQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (async (msg: CommandEnvelope) => {
      attemptCounts.set(msg.messageId, (attemptCounts.get(msg.messageId) ?? 0) + 1);
      return handler(msg);
    }) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT_M, () => db.transaction(async (tx) => {
    await tx.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT_M));
    await tx.delete(movements).where(eq(movements.tenantId, TENANT_M)); // cascades to movement_lines
    await tx.delete(stockBalances).where(eq(stockBalances.tenantId, TENANT_M));
    await tx.delete(items).where(eq(items.tenantId, TENANT_M));
    await tx.delete(stores).where(eq(stores.tenantId, TENANT_M));
  }));
}

async function seed(): Promise<void> {
  await runWithTenant(TENANT_M, () => db.transaction(async (tx) => {
    await tx.insert(stores).values([
      { id: STORE_1, tenantId: TENANT_M, name: "Movements DLQ Store 1", code: "MOV-DLQ-1", createdBy: ACTOR_M, updatedBy: ACTOR_M },
      { id: STORE_2, tenantId: TENANT_M, name: "Movements DLQ Store 2", code: "MOV-DLQ-2", createdBy: ACTOR_M, updatedBy: ACTOR_M },
    ]).onConflictDoNothing();
    await tx.insert(items).values([
      { id: ITEM_OVERISSUE, tenantId: TENANT_M, name: "DLQ overissue item", sku: "MOV-DLQ-OI", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_M, updatedBy: ACTOR_M },
      { id: ITEM_LEGITIMATE, tenantId: TENANT_M, name: "DLQ legitimate item", sku: "MOV-DLQ-OK", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_M, updatedBy: ACTOR_M },
      { id: ITEM_TRANSFER, tenantId: TENANT_M, name: "DLQ transfer item", sku: "MOV-DLQ-TR", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_M, updatedBy: ACTOR_M },
    ]).onConflictDoNothing();
    // Matches the reported repro exactly: 15 units on hand.
    await tx.insert(stockBalances).values([
      { tenantId: TENANT_M, itemId: ITEM_OVERISSUE, storeId: STORE_1, onHandQty: 15, avgRateMinor: 500n, currency: "INR" },
      { tenantId: TENANT_M, itemId: ITEM_LEGITIMATE, storeId: STORE_1, onHandQty: 15, avgRateMinor: 500n, currency: "INR" },
      { tenantId: TENANT_M, itemId: ITEM_TRANSFER, storeId: STORE_1, onHandQty: 15, avgRateMinor: 500n, currency: "INR" },
    ]).onConflictDoNothing();
  }));
}

beforeAll(async () => {
  countingQueue(wireTenantAwareQueue(queue));
  registerMovementConsumers(queue);
  app = await buildApp();
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("issue.create — overissue (guaranteed INSUFFICIENT_STOCK)", () => {
  it("dead-letters on the FIRST attempt — no wasted retries — and the caller can see it via GET", async () => {
    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;

    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues", headers: hdr(TENANT_M, ACTOR_M),
      payload: {
        fromStoreId: STORE_1, postingDate: "2026-01-15", reasonCode: "CONSUMPTION",
        lines: [{ itemId: ITEM_OVERISSUE, qty: 999_999 }],
      },
    });
    expect(res.statusCode).toBe(202);
    const issueId = res.json().id as string;

    await drain();

    expect(mq.dlq.slice(before).some((d) => d.error.includes("INSUFFICIENT_STOCK"))).toBe(true);
    // The core regression proof: exactly one delivery attempt. Before the
    // fix this was 5 (maxAttempts) — a plain Error is retried, not rejected.
    // The attempt counter is the direct proof that no retry backoff ran. A
    // wall-clock bound used to sit here as a proxy for the same thing
    // (elapsedMs < 200); it measured CI scheduler load rather than retries and
    // failed at 237-269 ms on busy runners even with exactly one attempt.
    expect(attemptCounts.get(issueId)).toBe(1);

    // The whole transaction (including the header insert) rolled back —
    // nothing was ever persisted for this id.
    const get = await app.inject({
      method: "GET", url: `/v1/inventory/movements/${issueId}`, headers: hdr(TENANT_M, ACTOR_M),
    });
    expect(get.statusCode).toBe(404);

    const balance = await runWithTenant(TENANT_M, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances).where(eq(stockBalances.itemId, ITEM_OVERISSUE))));
    expect(balance[0]?.onHandQty).toBe(15); // unchanged
  });
});

describe("issue.create — genuinely sufficient issue (fix does not affect the happy path)", () => {
  it("still succeeds on the first attempt, decrements the balance, and is visible via GET", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues", headers: hdr(TENANT_M, ACTOR_M),
      payload: {
        fromStoreId: STORE_1, postingDate: "2026-01-15", reasonCode: "CONSUMPTION",
        lines: [{ itemId: ITEM_LEGITIMATE, qty: 5 }],
      },
    });
    expect(res.statusCode).toBe(202);
    const issueId = res.json().id as string;
    await drain();

    expect(attemptCounts.get(issueId)).toBe(1);

    const get = await app.inject({
      method: "GET", url: `/v1/inventory/movements/${issueId}`, headers: hdr(TENANT_M, ACTOR_M),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.status).toBe("posted");
    expect(get.json().data.movementType).toBe("issue");

    const balance = await runWithTenant(TENANT_M, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances).where(eq(stockBalances.itemId, ITEM_LEGITIMATE))));
    expect(balance[0]?.onHandQty).toBe(10); // 15 - 5
  });
});

describe("transfer.create — overissue on the source leg (same assertSufficientStock, second call site)", () => {
  it("dead-letters on the FIRST attempt", async () => {
    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;

    const res = await app.inject({
      method: "POST", url: "/v1/inventory/transfers", headers: hdr(TENANT_M, ACTOR_M),
      payload: {
        fromStoreId: STORE_1, toStoreId: STORE_2, postingDate: "2026-01-15",
        lines: [{ itemId: ITEM_TRANSFER, qty: 999_999 }],
      },
    });
    expect(res.statusCode).toBe(202);
    const transferId = res.json().id as string;
    await drain();

    expect(mq.dlq.slice(before).some((d) => d.error.includes("INSUFFICIENT_STOCK"))).toBe(true);
    expect(attemptCounts.get(transferId)).toBe(1);

    const get = await app.inject({
      method: "GET", url: `/v1/inventory/movements/${transferId}`, headers: hdr(TENANT_M, ACTOR_M),
    });
    expect(get.statusCode).toBe(404);
  });
});

describe("GET /v1/inventory/movements/:id — read-side parity with batches/items/srn", () => {
  it("returns 404 for an id that was never posted", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inventory/movements/${randomUUID()}`, headers: hdr(TENANT_M, ACTOR_M),
    });
    expect(res.statusCode).toBe(404);
  });
});
