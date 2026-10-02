import { describe, it, expect } from "vitest";
import { mapStockLedgerEntries, mapCycleCountDetail } from "./apiMappers";

// GAP-INVENTORY-RECONCILE-02 / DETAIL-03: ledger sign comes from qtyIn/qtyOut,
// and an unknown voucherType is "other", never "receipt".
const row = (over: Record<string, unknown>) => ({ id: "r1", itemId: "11111111-2222-3333-4444-555555555555", qtyIn: 0, qtyOut: 0, balanceQty: 0, ...over });

describe("mapStockLedgerEntries sign handling", () => {
  it("adjustment with qtyOut 5 => direction out, signedQuantity -5, quantity stays absolute", () => {
    const [e] = mapStockLedgerEntries({ data: [row({ voucherType: "adjustment", qtyOut: 5 })] })!;
    expect(e).toMatchObject({ type: "adjustment", direction: "out", signedQuantity: -5, quantity: 5 });
  });

  it("transfer with qtyIn 3 => direction in, signedQuantity +3", () => {
    const [e] = mapStockLedgerEntries({ data: [row({ voucherType: "transfer", qtyIn: 3 })] })!;
    expect(e).toMatchObject({ type: "transfer", direction: "in", signedQuantity: 3, quantity: 3 });
  });

  it("the REAL stock-service voucher types transfer_in / transfer_out map to transfer", () => {
    const out = mapStockLedgerEntries({ data: [row({ voucherType: "transfer_out", qtyOut: 4 }), row({ id: "r2", voucherType: "transfer_in", qtyIn: 4 })] })!;
    expect(out[0]).toMatchObject({ type: "transfer", direction: "out", signedQuantity: -4 });
    expect(out[1]).toMatchObject({ type: "transfer", direction: "in", signedQuantity: 4 });
  });

  it("a row with both qtyIn 10 and qtyOut 3 displays the net 7", () => {
    const [e] = mapStockLedgerEntries({ data: [row({ voucherType: "adjustment", qtyIn: 10, qtyOut: 3 })] })!;
    expect(e).toMatchObject({ quantity: 7, signedQuantity: 7, direction: "in" });
  });

  it("an issue is out and a receipt is in", () => {
    const out = mapStockLedgerEntries({ data: [row({ voucherType: "issue", qtyOut: 2 }), row({ id: "r2", voucherType: "receipt", qtyIn: 7 })] })!;
    expect(out[0]).toMatchObject({ type: "issue", direction: "out", signedQuantity: -2 });
    expect(out[1]).toMatchObject({ type: "receipt", direction: "in", signedQuantity: 7 });
  });

  it("an unknown or missing voucherType is 'other', not 'receipt'", () => {
    const out = mapStockLedgerEntries({ data: [row({ voucherType: "write_off", qtyOut: 1 }), row({ id: "r2", qtyIn: 1 })] })!;
    expect(out[0]).toMatchObject({ type: "other", direction: "out" });
    expect(out[1]?.type).toBe("other");
  });
});

describe("mapCycleCountDetail createdBy", () => {
  it("carries createdBy so the page can apply maker != checker", () => {
    const m = mapCycleCountDetail({ id: "c", itemId: "i", warehouseId: "w", createdBy: "u-1", status: "pending_approval" });
    expect(m?.createdBy).toBe("u-1");
  });
});

describe("mapStockLedgerEntries keeps the item id (GAP-INVENTORY-RECONCILE-03)", () => {
  it("carries itemId so a page can join the item master", () => {
    const [e] = mapStockLedgerEntries({ data: [{ id: "l1", itemId: "11111111-2222-3333-4444-555555555555", voucherType: "receipt", qtyIn: 1 }] })!;
    expect(e.itemId).toBe("11111111-2222-3333-4444-555555555555");
  });
  it("omits itemId when the row has none", () => {
    const [e] = mapStockLedgerEntries({ data: [{ id: "l2", voucherType: "receipt", qtyIn: 1 }] })!;
    expect("itemId" in e).toBe(false);
  });
});

