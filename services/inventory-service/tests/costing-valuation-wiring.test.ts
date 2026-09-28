/**
 * Regression coverage for wiring the FIFO / WAVG / STANDARD costing engines
 * into the real receipt/issue flow (movements/consumer.ts).
 *
 * Before this fix, every receipt/issue unconditionally called weightedAvgRate,
 * so a FIFO-configured item's receipts were blended into a weighted average
 * and inventory.cost_layers was never written to. These tests drive the real
 * consumer end-to-end (MemoryQueue + registerMovementConsumers, same pattern
 * as tests/inventory.test.ts) and assert on the persisted cost_layers /
 * stock_balances / stock_ledger / outbox rows, plus the balances READ path
 * (queries.listBalances), which must sum open FIFO layers rather than do
 * qty × avgRateMinor.
 *
 * Uses MemoryQueue.drain() (the same "test aid" batch-consumer.test.ts,
 * item-consumer-integration.test.ts, items-extended-consumer.test.ts and
 * srn.test.ts already use) to await async fan-out deterministically, rather
 * than a fixed sleep — this host runs many concurrent agents/suites, and a
 * fixed-duration wait was observed to flake under that load.
 *
 *   1. FIFO — receipt, receipt, partial issue: oldest-layer-first consumption,
 *      exact (non-blended) GL cost, correct remaining layer state.
 *   2. FIFO — balance valuation reads the exact sum of remaining layers, not
 *      a floor-divided average (constructed so the two would visibly differ).
 *   3. WAVG — byte-identical to the pre-fix formula (cross-checked against the
 *      same numbers tests/inventory-recon.invariant.test.ts already proves).
 *   4. STANDARD — rate pinned to the item's configured unitCostMinor; receipts
 *      at a different price never move it.
 *   5. Mixed tenant — a FIFO item and a WAVG item posted interleaved in the
 *      SAME tenant/store: neither's layers/rate leak into the other's.
 *      (Does not cover the CONSUMED.grnAccepted receipt call site — that
 *      handler has its own, pre-existing, unrelated idempotency-key bug; see
 *      the NOTE on the "Mixed tenant" describe block below.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and, inArray } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { items } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { movements, movementLines, stockBalances, stockLedger } from "../src/modules/movements/schema.js";
import { costLayers } from "../src/modules/costing/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import * as queries from "../src/modules/movements/queries.js";
import { COMMANDS, INTEGRATION } from "../src/topics.js";

const ACTOR = "70000000-0000-4000-8000-000000000000";

/** Wrap MemoryQueue so consumer handlers run inside runWithTenant (sets GUC). */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** Start a fresh, tenant-aware, drainable MemoryQueue with the real consumer wired in. */
async function newQueue(): Promise<{ q: Queue; drain: () => Promise<void> }> {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerMovementConsumers(q);
  await q.start();
  return { q, drain: () => (q as unknown as MemoryQueue).drain() };
}

/**
 * `processed` is the idempotency/dedup table markProcessed() checks — it is
 * NOT tenant-scoped and outlives a tenant's own rows, so re-running this file
 * against the same (disposable) Postgres without clearing it would make every
 * receipt/issue below a silent no-op on the second run (stale messageId ⇒
 * markProcessed() returns false). `messageIds` must list every messageId the
 * block is about to publish.
 */
async function cleanupTenant(tenantId: string, messageIds: string[] = []): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(costLayers).where(eq(costLayers.tenantId, tenantId));
    await tx.delete(stockLedger).where(eq(stockLedger.tenantId, tenantId));
    await tx.delete(stockBalances).where(eq(stockBalances.tenantId, tenantId));
    await tx.delete(movementLines).where(eq(movementLines.tenantId, tenantId));
    await tx.delete(movements).where(eq(movements.tenantId, tenantId));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    await tx.delete(items).where(eq(items.tenantId, tenantId));
    await tx.delete(stores).where(eq(stores.tenantId, tenantId));
    if (messageIds.length > 0) {
      await tx.delete(processed).where(inArray(processed.messageId, messageIds));
    }
  }));
}

async function glTotalMinor(tenantId: string, movementId: string): Promise<bigint> {
  const rows = await runWithTenant(tenantId, () => db.transaction(async (tx) =>
    tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.eventType, INTEGRATION.glPost)))));
  const row = rows.find((r) => (r.payload as { movementId?: string }).movementId === movementId);
  const payload = row?.payload as { totalMinor: string } | undefined;
  return BigInt(payload?.totalMinor ?? "NaN");
}

// ──────────────────────────────────────────────────────────────────────────
// 1 + 2. FIFO
// ──────────────────────────────────────────────────────────────────────────

describe("FIFO valuation — real receipt/issue flow", () => {
  const TENANT = "77770000-0000-4000-8000-000000000001";
  const STORE_1 = "77770000-0000-4000-8000-000000000002";
  const ITEM_FIFO = "77770000-0000-4000-8000-000000000003";       // consumption-order case
  const ITEM_ROUNDING = "77770000-0000-4000-8000-000000000004";   // exact-sum-vs-average case
  const mid = (n: number) => `78880000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const messageIds = [1, 2, 3, 10, 11, 12, 13].map(mid);

  beforeAll(async () => {
    await cleanupTenant(TENANT, messageIds);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(stores).values([
        { id: STORE_1, tenantId: TENANT, name: "FIFO Store", code: "FIFO-1", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(items).values([
        { id: ITEM_FIFO, tenantId: TENANT, name: "FIFO Item", sku: "FIFO-A", valuationMethod: "FIFO", createdBy: ACTOR, updatedBy: ACTOR },
        { id: ITEM_ROUNDING, tenantId: TENANT, name: "FIFO Rounding Item", sku: "FIFO-B", valuationMethod: "FIFO", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
    }));
  });
  afterAll(async () => {
    await cleanupTenant(TENANT, messageIds);
  });

  it("receipt, receipt, partial issue: consumes the OLDEST layer first, leaves the exact remainder, and GL-posts the exact (non-blended) cost", async () => {
    const { q, drain } = await newQueue();

    // Receipt A: 10 @ 500 paise (2026-01-01)
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(1), type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c1", schemaVersion: "1.0",
      payload: { id: mid(1), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-01-01",
        lines: [{ itemId: ITEM_FIFO, qty: 10, rateMinor: 500, currency: "INR" }] },
    });
    await drain();
    // Receipt B: 10 @ 900 paise (2026-01-02)
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(2), type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c2", schemaVersion: "1.0",
      payload: { id: mid(2), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-01-02",
        lines: [{ itemId: ITEM_FIFO, qty: 10, rateMinor: 900, currency: "INR" }] },
    });
    await drain();

    // After both receipts: 20 on hand, two open layers, cost_layers has exactly 2 rows.
    const afterReceipts = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers)
        .where(and(eq(costLayers.tenantId, TENANT), eq(costLayers.itemId, ITEM_FIFO)))));
    expect(afterReceipts).toHaveLength(2);
    expect(afterReceipts.every((l) => l.remainingQty === l.qty)).toBe(true); // untouched so far

    // Issue 12: fully depletes layer A (10@500=5000), takes 2 from layer B (2*900=1800).
    // Hand-computed: cost of issue = 5000 + 1800 = 6800 (NOT 12*700=8400, the blended
    // WAVG rate this item would have gotten before the fix).
    await q.publish(COMMANDS.issueCreate, {
      messageId: mid(3), type: COMMANDS.issueCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c3", schemaVersion: "1.0",
      payload: { id: mid(3), tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-01-03",
        lines: [{ itemId: ITEM_FIFO, qty: 12, rateMinor: 0, currency: "INR" }] },
    });
    await drain();
    await q.stop();

    const layers = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers)
        .where(and(eq(costLayers.tenantId, TENANT), eq(costLayers.itemId, ITEM_FIFO)))
        .orderBy(costLayers.receiptDate)));
    expect(layers).toHaveLength(2); // rows are updated in place, never deleted
    expect(layers[0]?.remainingQty).toBe(0);   // layer A: fully depleted
    expect(layers[0]?.qty).toBe(10);           // original qty preserved (audit trail)
    expect(layers[1]?.remainingQty).toBe(8);   // layer B: 10 - 2
    expect(layers[1]?.unitCostPaise).toBe(900n);

    const bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_FIFO), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(8);       // 20 - 12
    expect(bal[0]?.avgRateMinor).toBe(900n); // only layer B remains — its own rate

    // GL posting for the issue must carry the EXACT FIFO cost, not qty × any average.
    expect(await glTotalMinor(TENANT, mid(3))).toBe(6800n);
  });

  it("balance valuation reads the exact sum of remaining layers, not a floor-divided average (constructed to visibly diverge)", async () => {
    const { q, drain } = await newQueue();

    // Three layers of 3 units each at different rates, then issue 2 (from the
    // oldest layer only) so THREE differently-rated layers remain open at once.
    const receipts = [
      { n: 10, rate: 1000, date: "2026-02-01" },
      { n: 11, rate: 2000, date: "2026-02-02" },
      { n: 12, rate: 3000, date: "2026-02-03" },
    ];
    for (const r of receipts) {
      await q.publish(COMMANDS.receiptCreate, {
        messageId: mid(r.n), type: COMMANDS.receiptCreate,
        tenantId: TENANT, actorId: ACTOR, correlationId: `c${r.n}`, schemaVersion: "1.0",
        payload: { id: mid(r.n), tenantId: TENANT, toStoreId: STORE_1, postingDate: r.date,
          lines: [{ itemId: ITEM_ROUNDING, qty: 3, rateMinor: r.rate, currency: "INR" }] },
      });
      await drain();
    }
    await q.publish(COMMANDS.issueCreate, {
      messageId: mid(13), type: COMMANDS.issueCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c13", schemaVersion: "1.0",
      payload: { id: mid(13), tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-02-04",
        lines: [{ itemId: ITEM_ROUNDING, qty: 2, rateMinor: 0, currency: "INR" }] },
    });
    await drain();
    await q.stop();

    // Remaining: 1@1000 + 3@2000 + 3@3000 = 1000 + 6000 + 9000 = 16000, qty 7.
    // True average 16000/7 = 2285.71..; floor(2285) × 7 = 15995 ≠ 16000 (off by 5).
    const bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_ROUNDING), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(7);
    expect(bal[0]?.avgRateMinor).toBe(2285n); // the floor-divided REFERENCE rate

    const naiveQtyTimesRate = BigInt(bal[0]!.onHandQty) * bal[0]!.avgRateMinor;
    expect(naiveQtyTimesRate).toBe(15995n); // proves qty × avgRate would UNDER-report value

    const view = await runWithTenant(TENANT, () => queries.listBalances(TENANT, { itemId: ITEM_ROUNDING, storeId: STORE_1, limit: 10, offset: 0 }));
    expect(view.data).toHaveLength(1);
    expect(view.data[0]?.valueMinor).toBe("16000"); // the FIX: exact layer sum, not 15995
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. WAVG — unaffected
// ──────────────────────────────────────────────────────────────────────────

describe("WAVG valuation — byte-identical to before this change", () => {
  const TENANT = "77770000-0000-4000-8000-000000000010";
  const STORE_1 = "77770000-0000-4000-8000-000000000011";
  const ITEM_WAVG_EXPLICIT = "77770000-0000-4000-8000-000000000012";
  const ITEM_WAVG_DEFAULT  = "77770000-0000-4000-8000-000000000013"; // valuationMethod omitted → schema default
  const wavgMids = (itemId: string) => [1, 2, 3].map((n) => `${itemId.slice(-8)}-a${String(n).padStart(3, "0")}-4000-8000-${String(n).padStart(12, "0")}`);
  const messageIds = [...wavgMids(ITEM_WAVG_EXPLICIT), ...wavgMids(ITEM_WAVG_DEFAULT)];

  beforeAll(async () => {
    await cleanupTenant(TENANT, messageIds);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(stores).values([
        { id: STORE_1, tenantId: TENANT, name: "WAVG Store", code: "WAVG-1", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(items).values([
        { id: ITEM_WAVG_EXPLICIT, tenantId: TENANT, name: "WAVG Item (explicit)", sku: "WAVG-A", valuationMethod: "WAVG", createdBy: ACTOR, updatedBy: ACTOR },
        { id: ITEM_WAVG_DEFAULT, tenantId: TENANT, name: "WAVG Item (default)", sku: "WAVG-B", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
    }));
  });
  afterAll(async () => {
    await cleanupTenant(TENANT, messageIds);
  });

  it.each([
    ["explicit valuationMethod: WAVG", ITEM_WAVG_EXPLICIT],
    ["default valuationMethod (schema default)", ITEM_WAVG_DEFAULT],
  ])("%s — matches the exact numbers the pure weightedAvgRate formula produces, and never touches cost_layers", async (_label, itemId) => {
    const { q, drain } = await newQueue();

    // Identical to tests/inventory-recon.invariant.test.ts's PURE proof scenario:
    // 100@10000 + 50@12000 → floor((100*10000+50*12000)/150) = 10666.
    await q.publish(COMMANDS.receiptCreate, {
      messageId: `${itemId.slice(-8)}-a001-4000-8000-000000000001`, type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "w1", schemaVersion: "1.0",
      payload: { id: `${itemId.slice(-8)}-a001-4000-8000-000000000001`, tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-03-01",
        lines: [{ itemId, qty: 100, rateMinor: 10000, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.receiptCreate, {
      messageId: `${itemId.slice(-8)}-a002-4000-8000-000000000002`, type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "w2", schemaVersion: "1.0",
      payload: { id: `${itemId.slice(-8)}-a002-4000-8000-000000000002`, tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-03-02",
        lines: [{ itemId, qty: 50, rateMinor: 12000, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.issueCreate, {
      messageId: `${itemId.slice(-8)}-a003-4000-8000-000000000003`, type: COMMANDS.issueCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "w3", schemaVersion: "1.0",
      payload: { id: `${itemId.slice(-8)}-a003-4000-8000-000000000003`, tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-03-03",
        lines: [{ itemId, qty: 30, rateMinor: 0, currency: "INR" }] },
    });
    await drain();
    await q.stop();

    const bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, itemId), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(120);      // 100 + 50 - 30
    expect(bal[0]?.avgRateMinor).toBe(10666n); // unchanged: issue never moves the WAVG rate

    // cost_layers must stay completely empty for a WAVG item.
    const layers = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers).where(and(eq(costLayers.tenantId, TENANT), eq(costLayers.itemId, itemId)))));
    expect(layers).toHaveLength(0);

    // The read path must still be the plain qty × rate for a WAVG item.
    const view = await runWithTenant(TENANT, () => queries.listBalances(TENANT, { itemId, storeId: STORE_1, limit: 10, offset: 0 }));
    expect(view.data[0]?.valueMinor).toBe((120n * 10666n).toString());
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. STANDARD
// ──────────────────────────────────────────────────────────────────────────

describe("STANDARD valuation — rate pinned to the item's configured unitCostMinor", () => {
  const TENANT = "77770000-0000-4000-8000-000000000020";
  const STORE_1 = "77770000-0000-4000-8000-000000000021";
  const ITEM_STD = "77770000-0000-4000-8000-000000000022";
  const mid = (n: number) => `78900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const messageIds = [1, 2, 3].map(mid);

  beforeAll(async () => {
    await cleanupTenant(TENANT, messageIds);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(stores).values([
        { id: STORE_1, tenantId: TENANT, name: "STD Store", code: "STD-1", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(items).values([
        { id: ITEM_STD, tenantId: TENANT, name: "Standard-cost Item", sku: "STD-A",
          valuationMethod: "STANDARD", unitCostMinor: 8000n, createdBy: ACTOR, updatedBy: ACTOR },
      ]);
    }));
  });
  afterAll(async () => {
    await cleanupTenant(TENANT, messageIds);
  });

  it("receipts at a different actual price never move the rate off the configured standard cost", async () => {
    const { q, drain } = await newQueue();

    // Actual receipt price (9500) deliberately differs from the standard cost (8000).
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(1), type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "s1", schemaVersion: "1.0",
      payload: { id: mid(1), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-04-01",
        lines: [{ itemId: ITEM_STD, qty: 10, rateMinor: 9500, currency: "INR" }] },
    });
    await drain();

    let bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_STD), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(10);
    expect(bal[0]?.avgRateMinor).toBe(8000n); // NOT 9500 — pinned to the standard cost

    // A second receipt at yet another different price (7000) — still pinned.
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(2), type: COMMANDS.receiptCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "s2", schemaVersion: "1.0",
      payload: { id: mid(2), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-04-02",
        lines: [{ itemId: ITEM_STD, qty: 5, rateMinor: 7000, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.issueCreate, {
      messageId: mid(3), type: COMMANDS.issueCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "s3", schemaVersion: "1.0",
      payload: { id: mid(3), tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-04-03",
        lines: [{ itemId: ITEM_STD, qty: 4, rateMinor: 0, currency: "INR" }] },
    });
    await drain();
    await q.stop();

    bal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_STD), eq(stockBalances.storeId, STORE_1)))));
    expect(bal[0]?.onHandQty).toBe(11);       // 10 + 5 - 4
    expect(bal[0]?.avgRateMinor).toBe(8000n); // still pinned

    // Issue is costed at the standard rate (4 × 8000), not any received price.
    expect(await glTotalMinor(TENANT, mid(3))).toBe(32000n);

    const layers = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers).where(and(eq(costLayers.tenantId, TENANT), eq(costLayers.itemId, ITEM_STD)))));
    expect(layers).toHaveLength(0); // STANDARD does not use cost layers
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Mixed tenant — no cross-contamination
// ──────────────────────────────────────────────────────────────────────────

describe("Mixed tenant — FIFO and WAVG items interleaved in the same store", () => {
  const TENANT = "77770000-0000-4000-8000-000000000030";
  const STORE_1 = "77770000-0000-4000-8000-000000000031";
  const ITEM_FIFO = "77770000-0000-4000-8000-000000000032";
  const ITEM_WAVG = "77770000-0000-4000-8000-000000000033";
  const mid = (n: number) => `78910000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  // NOTE: does not exercise CONSUMED.grnAccepted (the other receipt call site
  // postReceiptLine is also wired into) — that handler's own idempotency key
  // is a separate, pre-existing bug (a compound `${messageId}:grn:${grnId}`
  // string inserted into the `processed` table's strict `uuid` messageId
  // column, which rejects it for any real grnId), unrelated to this fix and
  // out of scope here; flagged separately.
  const messageIds = [1, 2, 3, 4, 6, 7].map(mid);

  beforeAll(async () => {
    await cleanupTenant(TENANT, messageIds);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(stores).values([
        { id: STORE_1, tenantId: TENANT, name: "Mixed Store", code: "MIX-1", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(items).values([
        { id: ITEM_FIFO, tenantId: TENANT, name: "Mixed FIFO Item", sku: "MIX-F", valuationMethod: "FIFO", createdBy: ACTOR, updatedBy: ACTOR },
        { id: ITEM_WAVG, tenantId: TENANT, name: "Mixed WAVG Item", sku: "MIX-W", valuationMethod: "WAVG", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
    }));
  });
  afterAll(async () => {
    await cleanupTenant(TENANT, messageIds);
  });

  it("interleaved receipts/issues on FIFO and WAVG items in the same tenant+store don't cross-contaminate", async () => {
    const { q, drain } = await newQueue();

    // Interleave: FIFO receipt, WAVG receipt, FIFO receipt, WAVG receipt, FIFO issue, WAVG issue.
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(1), type: COMMANDS.receiptCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "m1", schemaVersion: "1.0",
      payload: { id: mid(1), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-05-01",
        lines: [{ itemId: ITEM_FIFO, qty: 10, rateMinor: 400, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(2), type: COMMANDS.receiptCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "m2", schemaVersion: "1.0",
      payload: { id: mid(2), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-05-01",
        lines: [{ itemId: ITEM_WAVG, qty: 20, rateMinor: 300, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(3), type: COMMANDS.receiptCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "m3", schemaVersion: "1.0",
      payload: { id: mid(3), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-05-02",
        lines: [{ itemId: ITEM_FIFO, qty: 10, rateMinor: 800, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.receiptCreate, {
      messageId: mid(4), type: COMMANDS.receiptCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "m4", schemaVersion: "1.0",
      payload: { id: mid(4), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-05-02",
        lines: [{ itemId: ITEM_WAVG, qty: 10, rateMinor: 600, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.issueCreate, {
      messageId: mid(6), type: COMMANDS.issueCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "m6", schemaVersion: "1.0",
      payload: { id: mid(6), tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-05-04",
        lines: [{ itemId: ITEM_FIFO, qty: 12, rateMinor: 0, currency: "INR" }] },
    });
    await drain();
    await q.publish(COMMANDS.issueCreate, {
      messageId: mid(7), type: COMMANDS.issueCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "m7", schemaVersion: "1.0",
      payload: { id: mid(7), tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-05-04",
        lines: [{ itemId: ITEM_WAVG, qty: 8, rateMinor: 0, currency: "INR" }] },
    });
    await drain();
    await q.stop();

    // FIFO item: 10@400 + 10@800 = 20 on hand before issue; issue 12 depletes
    // layer1 (10@400) then takes 2 from layer2 (800) → cost 4000+1600=5600.
    const fifoLayers = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers)
        .where(and(eq(costLayers.tenantId, TENANT), eq(costLayers.itemId, ITEM_FIFO)))
        .orderBy(costLayers.receiptDate)));
    expect(fifoLayers).toHaveLength(2); // 400-layer, 800-layer
    expect(fifoLayers[0]?.remainingQty).toBe(0);   // fully depleted
    expect(fifoLayers[1]?.remainingQty).toBe(8);   // 10 - 2
    expect(fifoLayers[1]?.unitCostPaise).toBe(800n);

    const fifoBal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_FIFO), eq(stockBalances.storeId, STORE_1)))));
    expect(fifoBal[0]?.onHandQty).toBe(8); // 10 + 10 - 12

    // WAVG item: 20@300 + 10@600 → (6000+6000)/30=400; issue never moves the rate.
    const wavgBal = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(stockBalances)
        .where(and(eq(stockBalances.tenantId, TENANT), eq(stockBalances.itemId, ITEM_WAVG), eq(stockBalances.storeId, STORE_1)))));
    expect(wavgBal[0]?.onHandQty).toBe(22); // 20 + 10 - 8
    expect(wavgBal[0]?.avgRateMinor).toBe(400n);

    // No cross-contamination: the WAVG item owns zero cost_layers rows.
    const wavgLayers = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers).where(and(eq(costLayers.tenantId, TENANT), eq(costLayers.itemId, ITEM_WAVG)))));
    expect(wavgLayers).toHaveLength(0);

    // And every layer row that DOES exist for this tenant belongs to the FIFO item.
    const allLayersForTenant = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(costLayers).where(eq(costLayers.tenantId, TENANT))));
    expect(allLayersForTenant.every((l) => l.itemId === ITEM_FIFO)).toBe(true);

    // Read path stays correctly scoped per item too.
    const bothView = await runWithTenant(TENANT, () => queries.listBalances(TENANT, { storeId: STORE_1, limit: 10, offset: 0 }));
    const fifoView = bothView.data.find((b) => b.itemId === ITEM_FIFO);
    const wavgView = bothView.data.find((b) => b.itemId === ITEM_WAVG);
    expect(fifoView?.valueMinor).toBe((8n * 800n).toString()); // 6400 — sum of the one remaining layer
    expect(wavgView?.valueMinor).toBe((22n * 400n).toString());
  });
});

// One shared connection pool (shared/db.ts module singleton) backs every
// describe block above — close it exactly once, after all of them are done,
// not from a per-block afterAll (which would end it while a later block's
// beforeAll/it is still using it).
afterAll(async () => {
  await sqlClient.end();
});
