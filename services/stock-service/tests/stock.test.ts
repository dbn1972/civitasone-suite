/**
 * stock-service test suite
 *
 * Test 1 — Weighted avg valuation (pure): 100 units@100 + 50@120 → 106.66
 * Test 2 — Stock negative guard (pure): issue qty=150 when stock=100 → throws
 * Test 3 — CQRS wiring: stock.entry.create → consumer → ledger appended (MemoryQueue)
 * Test 4 — Idempotency: duplicate message skipped
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { stockEntries } from "../src/modules/entry/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerEntryConsumers } from "../src/modules/entry/consumer.js";
import { weightedAvgRate, assertStockNotNegative } from "../src/modules/entry/domain.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR    = "00000000-aaaa-4000-8000-000000000001";
const TENANT   = "11111111-aaaa-4000-8000-000000000001";
const WH_ID    = "aaaaaaaa-0000-4000-8000-000000000001";
const ITEM_1   = "bbbbbbbb-1111-4000-8000-000000000001";
const ITEM_2   = "bbbbbbbb-2222-4000-8000-000000000002";
const ENTRY_1  = "cccccccc-1111-4000-8000-000000000001";
const ENTRY_2  = "cccccccc-2222-4000-8000-000000000002";
const MSG_1    = "dddddddd-1111-4000-8000-000000000001";
const MSG_2    = "dddddddd-2222-4000-8000-000000000002";

async function wipe(entryId: string, msgId: string, itemId: string) {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(stockLedger).where(eq(stockLedger.entryId, entryId));
  await db.delete(stockEntries).where(eq(stockEntries.id, entryId));
  await db.delete(processed).where(eq(processed.messageId, msgId));
  await db.delete(stockValuationRates).where(
    and(eq(stockValuationRates.tenantId, TENANT), eq(stockValuationRates.itemId, itemId))
  );
}

// ── 1. Weighted average valuation — pure ──────────────────────────────────

describe("Entry domain — weighted average valuation (pure)", () => {
  it("100 units@100 paise + 50 units@120 paise → 106 paise (floor div)", () => {
    const newRate = weightedAvgRate({ qty: 100, rateMinor: 100n }, 50, 120n);
    // (100*100 + 50*120) / 150 = (10000+6000)/150 = 16000/150 = 106
    expect(newRate).toBe(106n);
  });

  it("empty stock + first receipt → receipt rate", () => {
    const newRate = weightedAvgRate({ qty: 0, rateMinor: 0n }, 100, 500n);
    expect(newRate).toBe(500n);
  });

  it("equal rates stays same rate", () => {
    const newRate = weightedAvgRate({ qty: 100, rateMinor: 200n }, 100, 200n);
    expect(newRate).toBe(200n);
  });
});

// ── 2. Stock negative guard — pure ────────────────────────────────────────

describe("Entry domain — stock negative guard (pure)", () => {
  it("issue qty=150 when stock=100 → throws INSUFFICIENT_STOCK", () => {
    expect(() => assertStockNotNegative(100, 150)).toThrowError("INSUFFICIENT_STOCK");
  });

  it("issue qty=100 when stock=100 → passes", () => {
    expect(() => assertStockNotNegative(100, 100)).not.toThrow();
  });

  it("issue qty=0 when stock=0 → passes (zero issue is neutral)", () => {
    expect(() => assertStockNotNegative(0, 0)).not.toThrow();
  });
});

// ── 3. CQRS wiring — stock entry receipt ─────────────────────────────────

describe("Entry consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(ENTRY_1, MSG_1, ITEM_1); });
  afterAll(async () => { await wipe(ENTRY_1, MSG_1, ITEM_1); });

  it("receipt entry: ledger appended, valuation updated, stock.entry.created in outbox", async () => {
    const q = new MemoryQueue();
    registerEntryConsumers(q);
    await q.start();

    await q.publish(COMMANDS.entryCreate, {
      messageId: MSG_1, type: COMMANDS.entryCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-stock-1", schemaVersion: "1.0",
      payload: {
        id: ENTRY_1, tenantId: TENANT,
        entryType: "receipt",
        postingDate: "2024-03-01",
        toWarehouseId: WH_ID,
        items: [{ itemId: ITEM_1, qty: 100, rateMinor: 10000, currency: "INR" }],
      },
    });

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    // Entry posted
    const entries = await db.select().from(stockEntries).where(eq(stockEntries.id, ENTRY_1));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("posted");

    // Ledger appended
    const ledger = await db.select().from(stockLedger).where(eq(stockLedger.entryId, ENTRY_1));
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(ledger[0]?.balanceQty).toBe(100);

    // Valuation updated
    const rates = await db.select().from(stockValuationRates)
      .where(and(eq(stockValuationRates.tenantId, TENANT), eq(stockValuationRates.itemId, ITEM_1)));
    expect(rates).toHaveLength(1);
    expect(rates[0]?.qty).toBe(100);
    expect(rates[0]?.rateMinor).toBe(10000n);

    // Events emitted
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const types = outbox.map((r) => r.eventType);
    expect(types).toContain("stock.entry.created");
    expect(types).toContain("audit.event.record");

    // _inbox.processed marked
    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_1));
    expect(seen).toHaveLength(1);
  });
});

// ── 3b. HTTP route auth guard (inject) ───────────────────────────────────

describe("stock-service route auth (inject)", () => {
  it("GET /v1/stock/dashboard without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/stock/dashboard" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/stock/ledger without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/stock/ledger without itemId (tenant-wide) but no token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger?limit=10" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── 4. Idempotency — duplicate message ───────────────────────────────────

describe("Entry consumer — idempotency (integration)", () => {
  beforeAll(async () => { await wipe(ENTRY_2, MSG_2, ITEM_2); });
  afterAll(async () => {
    await wipe(ENTRY_2, MSG_2, ITEM_2);
    await sqlClient.end();
  });

  it("duplicate entry create message processed only once", async () => {
    const q = new MemoryQueue();
    registerEntryConsumers(q);
    await q.start();

    const payload = {
      messageId: MSG_2, type: COMMANDS.entryCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-stock-2", schemaVersion: "1.0",
      payload: {
        id: ENTRY_2, tenantId: TENANT,
        entryType: "receipt",
        postingDate: "2024-03-02",
        toWarehouseId: WH_ID,
        items: [{ itemId: ITEM_2, qty: 50, rateMinor: 5000, currency: "INR" }],
      },
    };

    await q.publish(COMMANDS.entryCreate, payload);
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.publish(COMMANDS.entryCreate, payload);
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const entries = await db.select().from(stockEntries).where(eq(stockEntries.id, ENTRY_2));
    expect(entries).toHaveLength(1);

    const ledger = await db.select().from(stockLedger).where(eq(stockLedger.entryId, ENTRY_2));
    expect(ledger).toHaveLength(1);
  });
});
