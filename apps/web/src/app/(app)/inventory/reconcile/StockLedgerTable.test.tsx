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
    render(<StockLedgerTable rows={[entry({ type: "issue", quantity: 5 })]} />);
    expect(screen.getByText("▼ -5")).toBeInTheDocument();
  });

  it("omits the arrow for a zero quantity", () => {
    render(<StockLedgerTable rows={[entry({ type: "adjustment", quantity: 0 })]} />);
    expect(screen.getByText("+0")).toBeInTheDocument();
    expect(screen.queryByText(/▲|▼/)).not.toBeInTheDocument();
  });
});
