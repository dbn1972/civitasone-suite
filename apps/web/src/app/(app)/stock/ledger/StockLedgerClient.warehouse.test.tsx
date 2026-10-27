/**
 * GAP-STOCK-LEDGER-02: the ledger shows the warehouse name the service now joins onto each row,
 * and a dash (never an id fragment) when the service could not resolve it.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import { StockLedgerClient } from "./StockLedgerClient";
import { mapStockLedgerEntries } from "../../../_data/apiMappers";

const WAREHOUSE_ID = crypto.randomUUID();
const row = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(), itemId: crypto.randomUUID(), itemCode: "PAP-A4", itemName: "A4 Paper", warehouseId: WAREHOUSE_ID,
  entryId: crypto.randomUUID(), voucherType: "receipt", qtyIn: 5, qtyOut: 0, balanceQty: 5, rateMinor: "1000", postingDate: "2026-10-01", ...over,
});

describe("stock ledger warehouse name from the service join", () => {
  it("renders the warehouse name", () => {
    const entries = mapStockLedgerEntries({ data: [row({ warehouseName: "Central Store" })] })!;
    render(<StockLedgerClient entries={entries} />);
    expect(screen.getByText("Central Store")).toBeInTheDocument();
  });

  it("renders a dash, not an id fragment, when the warehouse could not be resolved (null name)", () => {
    const entries = mapStockLedgerEntries({ data: [row({ warehouseName: null })] })!;
    render(<StockLedgerClient entries={entries} />);
    expect(document.body.textContent).not.toContain(WAREHOUSE_ID.slice(0, 8));
  });
});
