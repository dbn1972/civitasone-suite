import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StockLedgerTable } from "./StockLedgerTable";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "le-1",
    itemCode: "ITM-001",
    itemName: "Test Item",
    date: "2026-08-01",
    type: "receipt",
    quantity: 10,
    direction: "in",
    signedQuantity: 10,
    totalValue: 10000,
    referenceNo: "REF-1",
    balance: 20,
    ...overrides,
  };
}

describe("StockLedgerTable — variance encoding (Req 3.3)", () => {
  it("prepends ▲ to a positive (receipt) quantity", () => {
    render(<StockLedgerTable rows={[entry({ type: "receipt", quantity: 10 })]} />);
    expect(screen.getByText("▲ +10")).toBeInTheDocument();
  });

  it("prepends ▼ to a negative (issue) quantity", () => {
    render(<StockLedgerTable rows={[entry({ type: "issue", quantity: 5, direction: "out", signedQuantity: -5 })]} />);
    expect(screen.getByText("▼ -5")).toBeInTheDocument();
  });

  it("omits the arrow for a zero quantity", () => {
    render(<StockLedgerTable rows={[entry({ type: "adjustment", quantity: 0 })]} />);
    expect(screen.getByText("+0")).toBeInTheDocument();
    expect(screen.queryByText(/▲|▼/)).not.toBeInTheDocument();
  });

  // GAP-INVENTORY-RECONCILE-02: sign follows direction, not the voucher type.
  it("renders a stock-reducing adjustment as ▼ -2, not +2", () => {
    render(<StockLedgerTable rows={[entry({ type: "adjustment", quantity: 2, direction: "out", signedQuantity: -2 })]} />);
    expect(screen.getByText("▼ -2")).toBeInTheDocument();
    expect(screen.queryByText("▲ +2")).not.toBeInTheDocument();
  });

  it("renders a transfer-in as ▲ +3", () => {
    render(<StockLedgerTable rows={[entry({ type: "transfer", quantity: 3, direction: "in", signedQuantity: 3 })]} />);
    expect(screen.getByText("▲ +3")).toBeInTheDocument();
  });
});
