/**
 * inventory-service test suite — mirrors stock-service test style.
 *
 *  1. Domain math (pure): weighted-average valuation, valuation totals.
 *  2. Domain guards (pure): insufficient-stock, low-stock + suggested reorder.
 *  3. Validation: zod request bodies reject bad input.
 *  4. Route auth (inject): protected reads require a token.
 *  5. CQRS wiring (DB): receipt posts balance + ledger + outbox events.
 *  6. Reorder trigger (DB): an issue that breaches reorder emits inventory.stock.low.
 *  7. Idempotency (DB): a duplicate command is applied once.
 *  8. Tenant isolation (DB): balances never leak across tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { items, categories, uoms } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { movements, movementLines, stockBalances, stockLedger } from "../src/modules/movements/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import {
  weightedAvgRate, assertSufficientStock, valuationMinor, isLowStock, suggestedReorderQty,
} from "../src/modules/movements/domain.js";
import * as queries from "../src/modules/movements/queries.js";
import {
  createReceiptBody, createTransferBody, createAdjustmentBody,
} from "../src/modules/movements/validators.js";
import { createItemBody } from "../src/modules/items/validators.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR    = "00000000-aaaa-4000-8000-000000000001";
const TENANT   = "11111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "11111111-bbbb-4000-8000-0000000000b2";
const STORE_1  = "22220000-0000-4000-8000-000000000001";
const STORE_2  = "22220000-0000-4000-8000-000000000002";
const ITEM_1   = "33330000-1111-4000-8000-000000000001"; // reorder level 10
const ITEM_2   = "33330000-2222-4000-8000-000000000002"; // reorder level 0 (untracked)

const MSG_RCPT = "44440000-1111-4000-8000-000000000001";
const MSG_ISSUE= "44440000-2222-4000-8000-000000000002";
const MSG_DUP  = "44440000-3333-4000-8000-000000000003";
const MSG_ISO  = "44440000-4444-4000-8000-000000000004";

/** Wrap MemoryQueue so consumer handlers run inside runWithTenant (sets GUC). */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function seed(): Promise<void> {
  await cleanup();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(stores).values([
      { id: STORE_1, tenantId: TENANT, name: "Central Store", code: "CS-1111", createdBy: ACTOR, updatedBy: ACTOR },
      { id: STORE_2, tenantId: TENANT, name: "Sub Store", code: "SS-1", createdBy: ACTOR, updatedBy: ACTOR },
    ]).onConflictDoNothing();
    await tx.insert(items).values([
      { id: ITEM_1, tenantId: TENANT, name: "A4 Paper Ream", sku: "PPR-A4", reorderLevel: 10, reorderQty: 50, createdBy: ACTOR, updatedBy: ACTOR },
      { id: ITEM_2, tenantId: TENANT, name: "Stapler", sku: "STP-01", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR },
    ]).onConflictDoNothing();
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.insert(stores).values([
      { id: "22221111-0000-4000-8000-0000000000b1", tenantId: TENANT_B, name: "Central Store", code: "CS-bbbb", createdBy: ACTOR, updatedBy: ACTOR },
    ]).onConflictDoNothing();
  }));
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, t));
      await tx.delete(stockBalances).where(eq(stockBalances.tenantId, t));
      await tx.delete(movementLines).where(eq(movementLines.tenantId, t));
      await tx.delete(movements).where(eq(movements.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
      await tx.delete(stores).where(eq(stores.tenantId, t));
      await tx.delete(categories).where(eq(categories.tenantId, t));
      await tx.delete(uoms).where(eq(uoms.tenantId, t));
    }));
  }
  for (const m of [MSG_RCPT, MSG_ISSUE, MSG_DUP, MSG_ISO]) {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, m));
    }));
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── 1. Domain math (pure) ──────────────────────────────────────────────────

describe("movement domain — weighted-average valuation (pure)", () => {
  it("100u@100p + 50u@120p → 106p (floor div)", () => {
    expect(weightedAvgRate({ qty: 100, rateMinor: 100n }, 50, 120n)).toBe(106n);
  });
  it("first receipt onto empty stock → receipt rate", () => {
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 100, 500n)).toBe(500n);
  });
  it("equal rates stay the same", () => {
    expect(weightedAvgRate({ qty: 100, rateMinor: 200n }, 100, 200n)).toBe(200n);
  });
  it("valuation total = qty * rate (paise)", () => {
    expect(valuationMinor(7, 2500n)).toBe(17500n);
  });
});

// ── 2. Domain guards (pure) ─────────────────────────────────────────────────

describe("movement domain — stock guards (pure)", () => {
  it("issue 150 when only 100 available → INSUFFICIENT_STOCK", () => {
    expect(() => assertSufficientStock(100, 150)).toThrowError("INSUFFICIENT_STOCK");
  });
  it("issue exactly the available qty → allowed", () => {
    expect(() => assertSufficientStock(100, 100)).not.toThrow();
  });
  it("low stock: on-hand at/below positive reorder level", () => {
    expect(isLowStock(5, 10)).toBe(true);
    expect(isLowStock(10, 10)).toBe(true);
    expect(isLowStock(11, 10)).toBe(false);
    expect(isLowStock(0, 0)).toBe(false); // untracked
  });
  it("suggested reorder tops stock up to (level + qty)", () => {
    expect(suggestedReorderQty(5, 10, 50)).toBe(55);
    expect(suggestedReorderQty(60, 10, 50)).toBe(50); // never below configured reorder qty
  });
});

// ── 3. Validation ────────────────────────────────────────────────────────

describe("request validators", () => {
  it("receipt requires at least one line", () => {
    expect(() => createReceiptBody.parse({ toStoreId: STORE_1, postingDate: "2024-03-01", lines: [] })).toThrow();
  });
  it("transfer rejects same source and destination store", () => {
    expect(() => createTransferBody.parse({
      fromStoreId: STORE_1, toStoreId: STORE_1, postingDate: "2024-03-01",
      lines: [{ itemId: ITEM_1, qty: 1 }],
    })).toThrow();
  });
  it("adjustment requires a reason code", () => {
    expect(() => createAdjustmentBody.parse({
      storeId: STORE_1, postingDate: "2024-03-01",
      lines: [{ itemId: ITEM_1, countedQty: 5 }],
    })).toThrow();
  });
  it("item create rejects empty name", () => {
    expect(() => createItemBody.parse({ name: "" })).toThrow();
  });
});

// ── 4. Route auth (inject) ─────────────────────────────────────────────────

describe("inventory-service route auth (inject)", () => {
  it("GET /v1/inventory/items without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/items" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it("GET /v1/inventory/balances without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/balances" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
  it("GET /v1/inventory/low-stock without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/low-stock" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── 5–8. DB-backed CQRS behaviour ──────────────────────────────────────────

describe("movement consumer — CQRS behaviour (integration)", () => {
  beforeAll(seed);
  afterAll(async () => {
    await cleanup();
    await sqlClient.end();
  });

  it("receipt posts balance + ledger + outbox events, and is idempotent", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerMovementConsumers(q);
    await q.start();

    const msg = {
      messageId: MSG_RCPT, type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rcpt", schemaVersion: "1.0",
      payload: {
        id: MSG_RCPT, tenantId: TENANT, toStoreId: STORE_1, postingDate: "2024-03-01",
        lines: [{ itemId: ITEM_1, qty: 100, rateMinor: 10000, currency: "INR" }],
      },
    };
    await q.publish(COMMANDS.receiptCreate, msg);
    await wait(500);
    await q.stop();

    // Redeliver the SAME messageId on a fresh consumer (fresh queue dedupe set)
    // so idempotency is enforced by markProcessed, not the in-memory bus.
    const q2 = wireTenantAwareQueue(new MemoryQueue());
    registerMovementConsumers(q2);
    await q2.start();
    await q2.publish(COMMANDS.receiptCreate, msg);
    await wait(400);
    await q2.stop();

    const bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_1), eq(stockBalances.storeId, STORE_1)))));
    expect(bal).toHaveLength(1);
    expect(bal[0]?.onHandQty).toBe(100);          // not 200 → idempotent (markProcessed)
    expect(bal[0]?.avgRateMinor).toBe(10000n);

    const led = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockLedger)
        .where(and(eq(stockLedger.tenantId, TENANT), eq(stockLedger.movementId, MSG_RCPT)))));
    expect(led).toHaveLength(1);
    expect(led[0]?.qtyIn).toBe(100);
    expect(led[0]?.balanceQty).toBe(100);

    const types = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))))).map((r) => r.eventType);
    expect(types).toContain(EVENTS.receiptPosted);
    expect(types).toContain("audit.event.record");
    expect(types).toContain("finance.gl.post");

    const seen = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_RCPT))));
    expect(seen).toHaveLength(1);
  });

  it("issue that breaches reorder level emits inventory.stock.low", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerMovementConsumers(q);
    await q.start();

    await q.publish(COMMANDS.issueCreate, {
      messageId: MSG_ISSUE, type: COMMANDS.issueCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-issue", schemaVersion: "1.0",
      payload: {
        id: MSG_ISSUE, tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2024-03-02",
        lines: [{ itemId: ITEM_1, qty: 95, rateMinor: 0, currency: "INR" }],
      },
    });
    await wait(500);
    await q.stop();

    const bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_1), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(5); // 100 - 95

    const low = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.stockLow)))));
    expect(low.length).toBeGreaterThanOrEqual(1);
    const payload = low[0]?.payload as { itemId: string; onHandQty: number; suggestedReorderQty: number };
    expect(payload.itemId).toBe(ITEM_1);
    expect(payload.onHandQty).toBe(5);
    expect(payload.suggestedReorderQty).toBe(55); // (10 + 50) - 5
  });

  it("rejects an issue that would drive stock negative (no balance mutation)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerMovementConsumers(q);
    await q.start();
    await q.publish(COMMANDS.issueCreate, {
      messageId: MSG_DUP, type: COMMANDS.issueCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-neg", schemaVersion: "1.0",
      payload: {
        id: MSG_DUP, tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2024-03-03",
        lines: [{ itemId: ITEM_1, qty: 9999, rateMinor: 0, currency: "INR" }],
      },
    });
    await wait(400);
    await q.stop();

    // Balance unchanged (still 5), and the failed movement rolled back.
    const bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_1), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(5);
    const mv = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(movements).where(eq(movements.id, MSG_DUP))));
    expect(mv).toHaveLength(0);
  });

  it("balances are tenant-scoped (no cross-tenant leak)", async () => {
    const ownTenant = await runWithTenant(TENANT, () => queries.listBalances(TENANT, { limit: 100, offset: 0 }));
    expect(ownTenant.data.some((b) => b.itemId === ITEM_1)).toBe(true);

    const otherTenant = await runWithTenant(TENANT_B, () => queries.listBalances(TENANT_B, { limit: 100, offset: 0 }));
    expect(otherTenant.data.some((b) => b.itemId === ITEM_1)).toBe(false);
  });
});
