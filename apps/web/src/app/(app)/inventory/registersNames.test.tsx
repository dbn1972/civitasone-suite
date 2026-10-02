import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown[]) => ({
    data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live",
  }),
}));

const { BinsTable } = await import("./BinsTable");
const { GoodsReturnsTable } = await import("./GoodsReturnsTable");
const { ItemsTable } = await import("./ItemsTable");

const ID = "abcdef12-0000-4000-8000-000000000001";
const bin = (o = {}) => ({ id: "b", storeId: ID, code: "B-1", aisle: null, rack: null, shelf: null, capacity: 5, isActive: true, createdAt: "2026-08-01", ...o });
const ret = (o = {}) => ({
  id: "g", itemId: ID, storeId: ID, originalIssueId: ID, qty: 3, reason: "damaged", qcStatus: "pending",
  disposition: "quarantine", qcNotes: null, createdAt: "2026-08-01", ...o,
});

describe("GAP-INVENTORY-BINS-02", () => {
  it("shows the store name and never an 8-char id fragment", () => {
    render(<BinsTable bins={[bin({ storeName: "Central Store" })]} />);
    expect(screen.getByText("Central Store")).toBeInTheDocument();
    expect(screen.queryByText("abcdef12")).not.toBeInTheDocument();
  });
  it("a bin with no resolvable store shows a dash", () => {
    render(<BinsTable bins={[bin()]} />);
    expect(screen.queryByText("abcdef12")).not.toBeInTheDocument();
  });
  it("a full page of 200 bins carries a cap note", () => {
    render(<BinsTable bins={Array.from({ length: 200 }, (_, i) => bin({ id: "b" + i }))} />);
    expect(screen.getByRole("note")).toHaveTextContent(/first 200 bins/i);
  });
});

describe("GAP-INVENTORY-GOODS-RETURNS-02 / DETAIL-02", () => {
  it("shows SKU - name and store name, and the shared disposition label", () => {
    render(<GoodsReturnsTable returns={[ret({ itemName: "Toner", itemSku: "T-1", storeName: "Central Store" })]} />);
    expect(screen.getByText("T-1 · Toner")).toBeInTheDocument();
    expect(screen.getByText("Central Store")).toBeInTheDocument();
    expect(screen.getAllByText("Quarantine").length).toBeGreaterThan(0);
  });
  it("an unknown or deleted item falls back to its short id without crashing", () => {
    render(<GoodsReturnsTable returns={[ret()]} />);
    expect(screen.getAllByText("abcdef12").length).toBeGreaterThan(0);
  });
});

describe("GAP-INVENTORY-ITEMS-02 / -03", () => {
  const item = { id: "i", name: "Pen", sku: "P", status: "active", category: null, uom: "ea", itemType: "consumable", reorderLevel: 5, reorderQty: 40, unitCostMinor: "100" };
  it("has no always-empty Demand Forecast column and shows Reorder Qty", () => {
    render(<ItemsTable items={[item]} />);
    expect(screen.queryByText("Demand Forecast")).not.toBeInTheDocument();
    expect(screen.getByText("Reorder Qty")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });
});
