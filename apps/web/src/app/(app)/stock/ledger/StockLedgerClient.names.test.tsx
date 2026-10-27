/**
 * GAP-STOCK-LEDGER-03: the ledger shows the SKU + item name the service now joins onto each row,
 * and "Unknown item" (never an id fragment) when the service could not resolve them.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import { StockLedgerClient } from "./StockLedgerClient";
import { mapStockLedgerEntries } from "../../../_data/apiMappers";

const ITEM_ID = crypto.randomUUID();
const row = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(), itemId: ITEM_ID, warehouseId: crypto.randomUUID(), entryId: crypto.randomUUID(),
  voucherType: "receipt", qtyIn: 5, qtyOut: 0, balanceQty: 5, rateMinor: "1000", postingDate: "2026-10-01", ...over,
});

describe("stock ledger item names from the service join", () => {
  it("renders SKU and item name", () => {
    const entries = mapStockLedgerEntries({ data: [row({ itemCode: "PAP-A4", itemName: "A4 Paper" })] })!;
    render(<StockLedgerClient entries={entries} />);
    expect(screen.getByText("PAP-A4 A4 Paper")).toBeInTheDocument();
  });

  it("renders Unknown item for rows the service could not resolve (null names)", () => {
    const entries = mapStockLedgerEntries({ data: [row({ itemCode: null, itemName: null })] })!;
    render(<StockLedgerClient entries={entries} />);
    expect(screen.getByText("Unknown item")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(ITEM_ID.slice(0, 8));
    expect(document.body.textContent).not.toContain(ITEM_ID.slice(0, 8).toUpperCase());
  });

  it("shows only the name when the SKU is missing", () => {
    const entries = mapStockLedgerEntries({ data: [row({ itemCode: null, itemName: "A4 Paper" })] })!;
    render(<StockLedgerClient entries={entries} />);
    expect(screen.getByText("A4 Paper")).toBeInTheDocument();
  });
});
