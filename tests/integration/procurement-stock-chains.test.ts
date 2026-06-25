/**
 * 10-T3 Chain #1 — Real cross-service event chain:
 *   procurement.grn.accepted → stock-service consumable receipt.
 *
 * The UAT gap report lists this hop as WIRED (stock `entry/consumer.ts`
 * subscribes `procurement.grn.accepted`) but UNTESTED. Unlike the simpler chains,
 * the stock consumer READS-BEFORE-WRITES (`getValuationRate` via `db.select`) and
 * UPSERTS the moving-average valuation rate (`.onConflictDoUpdate`), so it needs
 * the 10-T3 harness extension: a seedable `select()` plus a thenable insert that
 * honours `.onConflictDoUpdate`.
 *
 * We publish the producer's `procurement.grn.accepted`, let the REAL stock
 * consumer react, and assert it (a) upserts a moving-average valuation rate that
 * blends the seeded on-hand stock with the receipt, (b) appends a stock-ledger
 * receipt row, and (c) records a FIFO receipt batch — all captured by the
 * in-memory db stub. Redelivery is gated per item by `${messageId}:${itemCode}`.
 *
 * DB + outbox + cache are stubbed in-memory so it runs in CI with no Postgres.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- stock-service data layer ----------------------------------------------
vi.mock("../../services/stock-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

vi.mock("../../services/stock-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});

// cache.invalidateResource runs outside the tx — stub so no Redis is needed.
vi.mock("../../services/stock-service/src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    invalidateResource: async () => {},
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

const { registerEntryConsumers } = await import(
  "../../services/stock-service/src/modules/entry/consumer.js"
);

const TENANT = "66666666-1111-4000-8000-000000000001";
const ACTOR = "77777777-2222-4000-8000-000000000001";
const ITEM_ID = "88888888-3333-4000-8000-000000000001";
const WAREHOUSE = "99999999-4444-4000-8000-000000000001";

function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerEntryConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Cross-service chain #1: procurement.grn.accepted → stock receipt + moving-avg valuation", () => {
  it("an accepted GRN blends a moving-average rate and appends ledger + FIFO receipt", async () => {
    // Seed existing on-hand stock the consumer reads via getValuationRate:
    // 100 units @ 1000 minor. Receipt below: 100 units @ 2000 minor.
    // Weighted-avg = (100*1000 + 100*2000) / 200 = 1500 minor, qty = 200.
    harness.seedSelect("valuation_rates", [{ qty: 100, rateMinor: 1000n }]);

    await harness.queue.publish(
      "procurement.grn.accepted",
      envelope("d1000001-0001-4000-8000-000000000001", "procurement.grn.accepted", {
        grnId: "grn-1",
        poRef: "PO-700",
        vendorId: "vend-1",
        warehouseId: WAREHOUSE,
        items: [
          {
            itemCode: "BOLT-01",
            itemName: "Bolt",
            acceptedQty: 100,
            rateMinor: 2000,
            currency: "INR",
            itemType: "consumable",
            itemId: ITEM_ID,
          },
        ],
      }),
    );
    await new Promise((r) => setTimeout(r, 250));

    // (a) moving-average valuation upsert into stock_valuation_rates.
    const valuationRows = harness.inserts.filter((i) => i.table.includes("valuation_rates"));
    expect(valuationRows).toHaveLength(1);
    const v = valuationRows[0].row as Record<string, unknown>;
    expect(v.tenantId).toBe(TENANT);
    expect(v.itemId).toBe(ITEM_ID);
    expect(v.warehouseId).toBe(WAREHOUSE);
    expect(v.qty).toBe(200); // 100 on-hand + 100 received
    expect(v.rateMinor).toBe(1500n); // weighted average of 1000 & 2000

    // (b) stock-ledger receipt row carrying the new balance + blended rate.
    const ledgerRows = harness.inserts.filter((i) => i.table.includes("ledger"));
    expect(ledgerRows).toHaveLength(1);
    const l = ledgerRows[0].row as Record<string, unknown>;
    expect(l.voucherType).toBe("receipt");
    expect(l.qtyIn).toBe(100);
    expect(l.qtyOut).toBe(0);
    expect(l.balanceQty).toBe(200);
    expect(l.rateMinor).toBe(1500n);

    // (c) FIFO receipt batch on inbound stock.
    const receiptRows = harness.inserts.filter((i) => i.table.includes("receipts"));
    expect(receiptRows).toHaveLength(1);
    const rc = receiptRows[0].row as Record<string, unknown>;
    expect(rc.quantity).toBe(100);
    expect(rc.remainingQty).toBe(100);
    expect(rc.unitCostMinor).toBe(2000n);
  });

  it("skips fixed_asset GRN lines and lines missing an itemId (no stock rows)", async () => {
    await harness.queue.publish(
      "procurement.grn.accepted",
      envelope("d1000002-0001-4000-8000-000000000001", "procurement.grn.accepted", {
        grnId: "grn-2",
        poRef: "PO-701",
        vendorId: "vend-2",
        items: [
          { itemCode: "AC-01", itemName: "AC Unit", acceptedQty: 1, rateMinor: 50000, itemType: "fixed_asset", itemId: "asset-x" },
          { itemCode: "NOID", itemName: "No item id", acceptedQty: 5, rateMinor: 100 }, // no itemId
        ],
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(harness.inserts).toHaveLength(0);
  });

  it("a redelivered GRN is processed once per item (idempotency across the hop)", async () => {
    harness.seedSelect("valuation_rates", [{ qty: 0, rateMinor: 0n }]);

    const dup = envelope("d1000003-0001-4000-8000-000000000001", "procurement.grn.accepted", {
      grnId: "grn-3",
      poRef: "PO-DUP",
      vendorId: "vend-3",
      warehouseId: WAREHOUSE,
      items: [
        { itemCode: "NUT-01", itemName: "Nut", acceptedQty: 10, rateMinor: 500, itemType: "consumable", itemId: ITEM_ID },
      ],
    });

    await harness.queue.publish("procurement.grn.accepted", dup);
    await harness.queue.publish("procurement.grn.accepted", dup);
    await new Promise((r) => setTimeout(r, 300));

    // Same messageId+itemCode twice → markProcessed gates the second delivery.
    const ledgerRows = harness.inserts.filter((i) => i.table.includes("ledger"));
    expect(ledgerRows).toHaveLength(1);
    const receiptRows = harness.inserts.filter((i) => i.table.includes("receipts"));
    expect(receiptRows).toHaveLength(1);
  });
});
