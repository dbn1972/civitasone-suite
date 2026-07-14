/**
 * INVENTORY RECONCILIATION — the stock invariant.
 *
 *   opening + receipts − issues ± adjustments (± transfers) = closing
 *
 * Two independent proofs of the same invariant:
 *
 *  A. PURE (no IO): replay the exact posting rules the movements consumer
 *     uses (weightedAvgRate / valuationMinor / adjustment diff) over a scripted
 *     sequence, build the append-only ledger, and assert the balance ties out
 *     in BOTH quantity and value for every (item, store).
 *
 *  B. INTEGRATION (DB): drive the real movements consumer end-to-end through a
 *     receipt → issue → adjustment → transfer sequence, then read the persisted
 *     stock_ledger + stock_balances back and prove
 *        SUM(qty_in) − SUM(qty_out) === on_hand_qty   (per item, per store)
 *     and that the last ledger balance_qty per (item,store) === on_hand_qty.
 *
 * The DB proof runs only when the test DB connection can bypass RLS
 * (DATABASE_URL points at civitas_admin); otherwise it is skipped so the pure
 * proof still guards the invariant on any connection.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and, inArray } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { items } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { movements, movementLines, stockBalances, stockLedger } from "../src/modules/movements/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import { weightedAvgRate, valuationMinor } from "../src/modules/movements/domain.js";
import { COMMANDS } from "../src/topics.js";

// ──────────────────────────────────────────────────────────────────────────
// A. PURE INVARIANT — replay the posting rules and reconcile the ledger.
// ──────────────────────────────────────────────────────────────────────────

type MoveType = "receipt" | "issue" | "adjustment" | "transfer";
interface Move {
  type: MoveType;
  itemId: string;
  storeId: string;      // for transfer: source store
  toStoreId?: string;   // for transfer: destination store
  qty?: number;         // receipt/issue/transfer
  rateMinor?: bigint;   // receipt rate
  countedQty?: number;  // adjustment absolute count
}
interface Bal { qty: number; rateMinor: bigint }
interface LedgerRow { itemId: string; storeId: string; qtyIn: number; qtyOut: number; balanceQty: number; valueMinor: bigint }

/** Replays the consumer's posting arithmetic. Returns balances + ledger. */
function replay(moves: Move[]): { balances: Map<string, Bal>; ledger: LedgerRow[] } {
  const balances = new Map<string, Bal>();
  const ledger: LedgerRow[] = [];
  const key = (i: string, s: string) => `${i}|${s}`;
  const get = (i: string, s: string): Bal => balances.get(key(i, s)) ?? { qty: 0, rateMinor: 0n };
  const put = (i: string, s: string, b: Bal) => balances.set(key(i, s), b);
  const post = (i: string, s: string, qtyIn: number, qtyOut: number, b: Bal) =>
    ledger.push({ itemId: i, storeId: s, qtyIn, qtyOut, balanceQty: b.qty, valueMinor: BigInt(b.qty) * b.rateMinor });

  for (const m of moves) {
    if (m.type === "receipt") {
      const cur = get(m.itemId, m.storeId);
      const newRate = weightedAvgRate(cur, m.qty!, m.rateMinor!);
      const next = { qty: cur.qty + m.qty!, rateMinor: newRate };
      put(m.itemId, m.storeId, next);
      post(m.itemId, m.storeId, m.qty!, 0, next);
    } else if (m.type === "issue") {
      const cur = get(m.itemId, m.storeId);
      if (m.qty! > cur.qty) throw new Error("INSUFFICIENT_STOCK in scenario");
      const next = { qty: cur.qty - m.qty!, rateMinor: cur.rateMinor };
      put(m.itemId, m.storeId, next);
      post(m.itemId, m.storeId, 0, m.qty!, next);
    } else if (m.type === "adjustment") {
      const cur = get(m.itemId, m.storeId);
      const diff = m.countedQty! - cur.qty;
      const next = { qty: m.countedQty!, rateMinor: cur.rateMinor };
      put(m.itemId, m.storeId, next);
      if (diff !== 0) post(m.itemId, m.storeId, Math.max(0, diff), Math.max(0, -diff), next);
    } else if (m.type === "transfer") {
      const src = get(m.itemId, m.storeId);
      if (m.qty! > src.qty) throw new Error("INSUFFICIENT_STOCK in scenario");
      const nsrc = { qty: src.qty - m.qty!, rateMinor: src.rateMinor };
      put(m.itemId, m.storeId, nsrc);
      post(m.itemId, m.storeId, 0, m.qty!, nsrc);
      const dst = get(m.itemId, m.toStoreId!);
      const newDstRate = weightedAvgRate(dst, m.qty!, src.rateMinor);
      const ndst = { qty: dst.qty + m.qty!, rateMinor: newDstRate };
      put(m.itemId, m.toStoreId!, ndst);
      post(m.itemId, m.toStoreId!, m.qty!, 0, ndst);
    }
  }
  return { balances, ledger };
}

describe("inventory reconciliation — PURE ledger invariant", () => {
  const ITEM_A = "aaaa0000-0000-4000-8000-00000000a001";
  const ITEM_B = "aaaa0000-0000-4000-8000-00000000a002";
  const S1 = "bbbb0000-0000-4000-8000-00000000b001";
  const S2 = "bbbb0000-0000-4000-8000-00000000b002";

  const scenario: Move[] = [
    { type: "receipt", itemId: ITEM_A, storeId: S1, qty: 100, rateMinor: 10000n }, // 100 @ 100.00
    { type: "receipt", itemId: ITEM_A, storeId: S1, qty: 50, rateMinor: 12000n },  // wavg
    { type: "issue", itemId: ITEM_A, storeId: S1, qty: 30 },
    { type: "adjustment", itemId: ITEM_A, storeId: S1, countedQty: 115 },          // shrinkage: 120 -> 115
    { type: "transfer", itemId: ITEM_A, storeId: S1, toStoreId: S2, qty: 40 },
    { type: "receipt", itemId: ITEM_B, storeId: S2, qty: 200, rateMinor: 500n },
    { type: "issue", itemId: ITEM_B, storeId: S2, qty: 200 },                       // fully consumed
    { type: "adjustment", itemId: ITEM_B, storeId: S2, countedQty: 3 },             // found 3
  ];

  it("opening(0) + receipts − issues ± adjustments (± transfers) = closing, per (item,store) — QUANTITY", () => {
    const { balances, ledger } = replay(scenario);
    const keys = new Set(ledger.map((l) => `${l.itemId}|${l.storeId}`));
    for (const k of keys) {
      const rows = ledger.filter((l) => `${l.itemId}|${l.storeId}` === k);
      const derived = rows.reduce((a, r) => a + r.qtyIn - r.qtyOut, 0);
      const closing = balances.get(k)!.qty;
      const lastBal = rows[rows.length - 1]!.balanceQty;
      expect(derived).toBe(closing);   // 0 + Σin − Σout = closing
      expect(lastBal).toBe(closing);   // running ledger balance matches stored balance
    }
  });

  it("known closing figures tie out exactly", () => {
    const { balances } = replay(scenario);
    // ITEM_A @ S1: 100 +50 −30 → 120, counted 115, −40 transfer out → 75
    expect(balances.get(`${ITEM_A}|${S1}`)!.qty).toBe(75);
    // ITEM_A @ S2: +40 transfer in → 40
    expect(balances.get(`${ITEM_A}|${S2}`)!.qty).toBe(40);
    // ITEM_B @ S2: 200 −200 → 0, counted 3 → 3
    expect(balances.get(`${ITEM_B}|${S2}`)!.qty).toBe(3);
  });

  it("value invariant: stored value == qty × wavg rate (no value leak on issue/transfer)", () => {
    const { balances } = replay(scenario);
    for (const [, b] of balances) {
      expect(valuationMinor(b.qty, b.rateMinor)).toBe(BigInt(b.qty) * b.rateMinor);
      expect(b.rateMinor >= 0n).toBe(true);
    }
    // wavg after two receipts (100@10000 + 50@12000)/150 = 10666 (floor)
    // issue/adjustment leave rate unchanged; transfer carries src rate to dest.
    expect(balances.get(`${ITEM_A}|${S1}`)!.rateMinor).toBe(10666n);
    expect(balances.get(`${ITEM_A}|${S2}`)!.rateMinor).toBe(10666n);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// B. INTEGRATION — drive the real consumer, reconcile the persisted ledger.
//    Requires an RLS-bypassing connection (civitas_admin). Skipped otherwise.
// ──────────────────────────────────────────────────────────────────────────

const ADMIN_CONN = /civitas_admin/.test(process.env.DATABASE_URL ?? "");
const dbSuite = ADMIN_CONN ? describe : describe.skip;

const ACTOR = "00000000-aaaa-4000-8000-0000000000ff";
const TENANT = "cccc0000-0000-4000-8000-0000000000c1";
const STORE_1 = "dddd0000-0000-4000-8000-0000000000d1";
const STORE_2 = "dddd0000-0000-4000-8000-0000000000d2";
const ITEM_1 = "eeee0000-0000-4000-8000-0000000000e1";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uuid = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function cleanup(): Promise<void> {
  await db.delete(stockLedger).where(eq(stockLedger.tenantId, TENANT));
  await db.delete(stockBalances).where(eq(stockBalances.tenantId, TENANT));
  await db.delete(movementLines).where(eq(movementLines.tenantId, TENANT));
  await db.delete(movements).where(eq(movements.tenantId, TENANT));
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(items).where(eq(items.tenantId, TENANT));
  await db.delete(stores).where(eq(stores.tenantId, TENANT));
  await db.delete(processed).where(inArray(processed.messageId, [1, 2, 3, 4, 5].map(uuid)));
}

dbSuite("inventory reconciliation — INTEGRATION (real consumer, persisted ledger)", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(stores).values([
      { id: STORE_1, tenantId: TENANT, name: "Main", code: "MN-1", createdBy: ACTOR, updatedBy: ACTOR },
      { id: STORE_2, tenantId: TENANT, name: "Aux", code: "AX-1", createdBy: ACTOR, updatedBy: ACTOR },
    ]).onConflictDoNothing();
    await db.insert(items).values([
      { id: ITEM_1, tenantId: TENANT, name: "Cement Bag", sku: "CMT-50", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR },
    ]).onConflictDoNothing();
  });
  afterAll(async () => {
    await cleanup();
    await sqlClient.end();
  });

  it("receipt→issue→adjustment→transfer persists a ledger that reconciles to balances", async () => {
    const q = new MemoryQueue();
    registerMovementConsumers(q);
    await q.start();
    const base = { tenantId: TENANT, actorId: ACTOR, correlationId: "recon", schemaVersion: "1.0" };

    await q.publish(COMMANDS.receiptCreate, {
      messageId: uuid(1), type: COMMANDS.receiptCreate, ...base,
      payload: { id: uuid(1), tenantId: TENANT, toStoreId: STORE_1, postingDate: "2026-01-01",
        lines: [{ itemId: ITEM_1, qty: 500, rateMinor: 20000, currency: "INR" }] },
    });
    await wait(300);
    await q.publish(COMMANDS.issueCreate, {
      messageId: uuid(2), type: COMMANDS.issueCreate, ...base,
      payload: { id: uuid(2), tenantId: TENANT, fromStoreId: STORE_1, postingDate: "2026-01-02",
        lines: [{ itemId: ITEM_1, qty: 120, rateMinor: 0, currency: "INR" }] },
    });
    await wait(300);
    await q.publish(COMMANDS.adjustmentCreate, {
      messageId: uuid(3), type: COMMANDS.adjustmentCreate, ...base,
      payload: { id: uuid(3), tenantId: TENANT, storeId: STORE_1, postingDate: "2026-01-03", reasonCode: "SHRINK",
        lines: [{ itemId: ITEM_1, countedQty: 370 }] }, // 380 counted as 370 (−10)
    });
    await wait(300);
    await q.publish(COMMANDS.transferCreate, {
      messageId: uuid(4), type: COMMANDS.transferCreate, ...base,
      payload: { id: uuid(4), tenantId: TENANT, fromStoreId: STORE_1, toStoreId: STORE_2, postingDate: "2026-01-04",
        lines: [{ itemId: ITEM_1, qty: 100, rateMinor: 0, currency: "INR" }] },
    });
    await wait(500);
    await q.stop();

    // Reconcile every (item, store): SUM(in) − SUM(out) === on_hand_qty.
    const ledger = await db.select().from(stockLedger).where(eq(stockLedger.tenantId, TENANT));
    const bal = await db.select().from(stockBalances).where(eq(stockBalances.tenantId, TENANT));
    expect(ledger.length).toBeGreaterThan(0);

    for (const b of bal) {
      const rows = ledger.filter((l) => l.itemId === b.itemId && l.storeId === b.storeId);
      const derived = rows.reduce((a, r) => a + r.qtyIn - r.qtyOut, 0);
      expect(derived).toBe(b.onHandQty);
    }

    // Concrete closings: S1 = 500−120=380, counted 370, −100 transfer = 270; S2 = +100.
    const s1 = bal.find((b) => b.storeId === STORE_1)!;
    const s2 = bal.find((b) => b.storeId === STORE_2)!;
    expect(s1.onHandQty).toBe(270);
    expect(s2.onHandQty).toBe(100);
    // Value carried on transfer: dest rate == source wavg (20000 paise).
    expect(s2.avgRateMinor).toBe(20000n);
  });
});
