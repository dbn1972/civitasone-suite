import { describe, it, expect } from "vitest";
import { movementRowsFromInventoryLedger } from "./_dataLedger";

const base = { id: "r", movementId: "m", itemId: "aaaaaaaa-0000-4000-8000-000000000001", storeId: "s", rateMinor: "100", reasonCode: null, postingDate: "2026-11-12", balanceQty: 5 };
describe("movementRowsFromInventoryLedger", () => {
  it("signs quantities by in/out, keeps names and reference, falls back to short ids", () => {
    const [a, b, c] = movementRowsFromInventoryLedger([
      { ...base, movementType: "receipt", qtyIn: 10, qtyOut: 0, valueMinor: "1000", itemName: "Pen", itemSku: "P1", refNo: "R-1" },
      { ...base, id: "r2", movementType: "issue", qtyIn: 0, qtyOut: 4, valueMinor: "400" },
      { ...base, id: "r3", movementType: "weird", qtyIn: 1, qtyOut: 0, valueMinor: "not-a-number" },
    ] as never);
    expect(a).toMatchObject({ type: "receipt", signedQuantity: 10, direction: "in", quantity: 10, itemCode: "P1", itemName: "Pen", referenceNo: "R-1", totalValue: 1000 });
    expect(b).toMatchObject({ type: "issue", signedQuantity: -4, direction: "out", quantity: 4, itemCode: "AAAAAAAA", itemName: "aaaaaaaa" });
    expect(b?.referenceNo).toBeUndefined();
    expect(c).toMatchObject({ type: "other", totalValue: 0 });
  });
});
