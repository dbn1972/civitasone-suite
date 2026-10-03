import { describe, it, expect } from "vitest";
import { mapPayments } from "./loaders";

describe("mapPayments all-rows-dropped guard (GAP-FINANCE-TREASURY-E-PAYMENTS-04)", () => {
  it("an empty array is an empty register, not an error", () => {
    expect(mapPayments([])).toEqual([]);
  });

  it("rows that ALL fail mapping (unknown statuses) surface as an error (null), not 'No payment orders'", () => {
    expect(mapPayments([{ id: "a", referenceId: "R", beneficiary: "B", amountDisplay: "₹1", status: "weird" }])).toBeNull();
  });

  it("a mix keeps the valid rows", () => {
    const rows = mapPayments([
      { id: "a", referenceId: "R", beneficiary: "B", amountDisplay: "₹1", status: "weird" },
      { id: "b", referenceId: "R2", beneficiary: "B", amountDisplay: "₹1", status: "failed" },
    ]);
    expect(rows).toHaveLength(1);
  });
});
