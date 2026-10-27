/**
 * GAP-STOCK-LEDGER-04: signed quantity uses signedQuantity, not voucher type.
 * GAP-STOCK-LEDGER-06: Transfer / Adjustment filters shown.
 * GAP-STOCK-LEDGER-07: referenceNo column rendered.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";
import { StockLedgerClient } from "./StockLedgerClient";

const BASE = {
  id: "e1", date: "2026-09-01",
  itemCode: "INK001", itemName: "Printer ink",
  quantity: 5, balance: 20, totalValue: 5000,
};

describe("GAP-STOCK-LEDGER-04: quantity sign from signedQuantity", () => {
  it("transfer with qtyOut shows minus sign", () => {
    render(
      <StockLedgerClient
        entries={[{ ...BASE, signedQuantity: -5, type: "transfer" }]}
      />
    );
    // minus sign (−) present
    expect(screen.getByText(/−5/)).toBeTruthy();
  });

  it("receipt with qtyIn shows plus sign", () => {
    render(
      <StockLedgerClient
        entries={[{ ...BASE, signedQuantity: 3, type: "receipt" }]}
      />
    );
    expect(screen.getByText(/\+3/)).toBeTruthy();
  });

  it("adjustment with negative signedQuantity shows minus", () => {
    render(
      <StockLedgerClient
        entries={[{ ...BASE, signedQuantity: -2, type: "adjustment" }]}
      />
    );
    expect(screen.getByText(/−2/)).toBeTruthy();
  });
});

describe("GAP-STOCK-LEDGER-06: filter includes Transfers and Adjustments", () => {
  it("shows Transfers and Adjustments in segmented control", () => {
    render(<StockLedgerClient entries={[]} />);
    expect(screen.getByText("Transfers")).toBeTruthy();
    expect(screen.getByText("Adjustments")).toBeTruthy();
  });

  it("Transfers filter shows only transfer rows", () => {
    render(
      <StockLedgerClient
        entries={[
          { ...BASE, id: "e1", signedQuantity: 5, type: "receipt", referenceNo: "REC-001" },
          { ...BASE, id: "e2", signedQuantity: -3, type: "transfer", referenceNo: "TRF-001" },
        ]}
      />
    );
    fireEvent.click(screen.getByText("Transfers"));
    expect(screen.queryByText("REC-001")).toBeNull();
    expect(screen.getByText("TRF-001")).toBeTruthy();
  });
});

describe("GAP-STOCK-LEDGER-07: referenceNo column", () => {
  it("renders reference number in the table", () => {
    render(
      <StockLedgerClient
        entries={[{ ...BASE, signedQuantity: 5, type: "receipt", referenceNo: "GRN-042" }]}
      />
    );
    expect(screen.getByText("GRN-042")).toBeTruthy();
  });

  it("falls back to em-dash when referenceNo absent", () => {
    render(
      <StockLedgerClient
        entries={[{ ...BASE, signedQuantity: 5, type: "receipt" }]}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
