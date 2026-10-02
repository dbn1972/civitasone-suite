import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InventoryLedgerRow } from "./_data";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[]) => ({
    data: initialData,
    fromCache: false,
    offline: false,
    cachedAt: null,
  }),
}));

const { MovementsTable } = await import("./MovementsTable");

function row(overrides: Partial<InventoryLedgerRow> = {}): InventoryLedgerRow {
  return {
    id: "led-1",
    movementId: "mv-1",
    movementType: "receipt",
    itemId: "11111111-2222-3333-4444-555555555555",
    storeId: "store-1",
    qtyIn: 10,
    qtyOut: 0,
    balanceQty: 10,
    rateMinor: "10000",
    valueMinor: "100000",
    reasonCode: null,
    postingDate: "2026-08-01",
    ...overrides,
  };
}

describe("MovementsTable (GAP-INVENTORY-ISSUES-02 / -03)", () => {
  it("names the item and store, shows the reason, and has no repeated Type column", () => {
    render(
      <MovementsTable
        entries={[row({ movementType: "issue", qtyIn: 0, qtyOut: 5, itemName: "Toner", itemSku: "T-1", storeName: "Main Store", reasonCode: "consumption" })]}
        kind="issue"
      />,
    );
    expect(screen.getByText("T-1 · Toner")).toBeInTheDocument();
    expect(screen.getByText("Main Store")).toBeInTheDocument();
    expect(screen.getByText("consumption")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^type$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("11111111")).not.toBeInTheDocument();
  });

  it("an unresolvable item falls back to its short id", () => {
    render(<MovementsTable entries={[row()]} kind="receipt" />);
    expect(screen.getByText("11111111")).toBeInTheDocument();
  });

  it("a full ledger page is flagged and the totals read as lower bounds", () => {
    const many = Array.from({ length: 500 }, (_, n) => row({ id: "l" + n, movementType: "issue", qtyIn: 0, qtyOut: 1 }));
    render(<MovementsTable entries={many} kind="issue" />);
    expect(screen.getByRole("note")).toHaveTextContent(/first 500 ledger movements/i);
    expect(screen.getAllByText("500+")).toHaveLength(2);
  });

  it("a short page shows no cap note", () => {
    render(<MovementsTable entries={[row({ movementType: "issue", qtyIn: 0, qtyOut: 5 })]} kind="issue" />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
