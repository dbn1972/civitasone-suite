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

describe("MovementsTable — movement type chip ARIA (Req 3.2)", () => {
  it("renders the movement type chip with role=status and a descriptive aria-label", () => {
    render(<MovementsTable entries={[row({ movementType: "receipt" })]} kind="receipt" />);
    const chip = screen.getByRole("status", { name: "Movement type: receipt" });
    expect(chip).toBeInTheDocument();
  });

  it("labels an issue-kind row's chip with its own movement type", () => {
    render(<MovementsTable entries={[row({ movementType: "issue", qtyIn: 0, qtyOut: 5 })]} kind="issue" />);
    const chip = screen.getByRole("status", { name: "Movement type: issue" });
    expect(chip).toBeInTheDocument();
  });
});
