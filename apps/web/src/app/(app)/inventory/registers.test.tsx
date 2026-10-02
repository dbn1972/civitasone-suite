import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DataProvenance } from "@/lib/sync/resource";

/**
 * GAP-INVENTORY-{BINS,GOODS-RETURNS,ISSUES,ITEMS,LOW-STOCK,RECEIPTS,RESERVATIONS,
 * SUBSTITUTES}-01: a failed fetch must never read as an empty, healthy store.
 * Every register feeds its stats, badge and failure state from ONE
 * useSeededResource call.
 */
const state: { provenance: DataProvenance; rows: unknown[] } = { provenance: "live", rows: [] };
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initial: unknown[]) => ({
    data: state.rows.length > 0 ? state.rows : initial,
    fromCache: state.provenance === "cached",
    offline: false,
    cachedAt: state.provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null,
    provenance: state.provenance,
  }),
}));

const { BinsTable } = await import("./BinsTable");
const { GoodsReturnsTable } = await import("./GoodsReturnsTable");
const { ItemsTable } = await import("./ItemsTable");
const { LowStockTable } = await import("./LowStockTable");
const { ReservationsTable } = await import("./ReservationsTable");
const { SubstitutesTable } = await import("./SubstitutesTable");
const { MovementsTable } = await import("./MovementsTable");

const ID = "11111111-2222-3333-4444-555555555555";

const registers: Array<{ name: string; ui: () => JSX.Element; area: RegExp; sample: unknown }> = [
  { name: "bins", ui: () => <BinsTable bins={[]} source="error" />, area: /bins and racks/, sample: { id: "b1", code: "B-1", storeId: ID, aisle: null, rack: null, shelf: null, capacity: 5, isActive: true, createdAt: "2026-08-01" } },
  { name: "goods returns", ui: () => <GoodsReturnsTable returns={[]} source="error" />, area: /goods returns/, sample: { id: "g1", itemId: ID, storeId: ID, originalIssueId: ID, qty: "3", reason: "damaged", qcStatus: "pending", disposition: "quarantine", createdAt: "2026-08-01" } },
  { name: "items", ui: () => <ItemsTable items={[]} source="error" />, area: /item master/, sample: { id: "i1", sku: "S1", name: "Pen", category: null, uom: "ea", itemType: "consumable", reorderLevel: 5, reorderQty: 10, unitCostMinor: "100", status: "active" } },
  { name: "low stock", ui: () => <LowStockTable rows={[]} source="error" />, area: /low-stock alerts/, sample: { itemId: "i1", sku: "S1", name: "Pen", onHandQty: 1, reorderLevel: 5, suggestedReorderQty: 10 } },
  { name: "reservations", ui: () => <ReservationsTable reservations={[]} source="error" />, area: /stock reservations/, sample: { id: "r1", itemId: ID, storeId: ID, qty: "2", refType: "indent", refId: ID, status: "active", expiresAt: null, createdAt: "2026-08-01" } },
  { name: "substitutes", ui: () => <SubstitutesTable substitutes={[]} source="error" />, area: /item substitutes/, sample: { id: "s1", itemId: ID, substituteId: ID, priority: 2, conversionFactor: "1", createdAt: "2026-08-01" } },
  { name: "receipts", ui: () => <MovementsTable entries={[]} kind="receipt" source="error" />, area: /stock ledger/, sample: { id: "l1", movementId: "m", movementType: "receipt", itemId: ID, storeId: ID, qtyIn: 4, qtyOut: 0, balanceQty: 4, rateMinor: "100", valueMinor: "400", reasonCode: null, postingDate: "2026-08-01" } },
  { name: "issues", ui: () => <MovementsTable entries={[]} kind="issue" source="error" />, area: /stock ledger/, sample: { id: "l2", movementId: "m", movementType: "issue", itemId: ID, storeId: ID, qtyIn: 0, qtyOut: 4, balanceQty: 0, rateMinor: "100", valueMinor: "400", reasonCode: null, postingDate: "2026-08-01" } },
];

describe.each(registers)("inventory $name register failure honesty", ({ ui, area, sample }) => {
  beforeEach(() => {
    state.provenance = "live";
    state.rows = [];
  });

  it("error with no cache: stats read '—', a retry state shows, no 'No records found' and no 'showing nothing' badge", () => {
    state.provenance = "error-no-data";
    const { container } = render(ui());
    expect(screen.getByText(area, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/no records found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
    // every stat is the "—" placeholder, never a fabricated 0
    const values = Array.from(container.querySelectorAll(".stat")).map((el) => el.textContent ?? "");
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).toContain("—");
    expect(values.join(" ")).not.toMatch(/(^|\D)0(\D|$)/);
  });

  it("error with cached rows: rows + stats from the cache and ONE 'saved data' note", () => {
    state.provenance = "cached";
    state.rows = [sample];
    render(ui());
    expect(screen.getAllByText(/Showing saved data/)).toHaveLength(1);
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });

  it("healthy empty list keeps a genuine 0 and no error state", () => {
    state.provenance = "live";
    const { container } = render(ui());
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
    const first = container.querySelector(".stat");
    expect(first?.textContent).toMatch(/0/);
    expect(first?.textContent).not.toContain("—");
  });
});

describe("goods returns: no unitless cross-item Total Qty (GAP-INVENTORY-GOODS-RETURNS-03)", () => {
  it("does not render a Total Qty stat", () => {
    state.provenance = "live";
    state.rows = [];
    render(<GoodsReturnsTable returns={[]} source="api" />);
    expect(screen.queryByText("Total Qty")).not.toBeInTheDocument();
  });
});

describe("substitutes: coverage warning (GAP-INVENTORY-SUBSTITUTES-02)", () => {
  it("warns when the item cap truncated the list and when some per-item loads failed", () => {
    state.provenance = "live";
    state.rows = [registers[5].sample];
    render(<SubstitutesTable substitutes={[]} source="api" coverage={{ truncated: true, failedCount: 2, itemCount: 60 }} />);
    expect(screen.getByText(/first 50 of 60 items/)).toBeInTheDocument();
    expect(screen.getByText(/2 items could not be loaded/)).toBeInTheDocument();
  });

  it("shows no warning for full coverage", () => {
    state.provenance = "live";
    state.rows = [registers[5].sample];
    render(<SubstitutesTable substitutes={[]} source="api" coverage={{ truncated: false, failedCount: 0, itemCount: 3 }} />);
    expect(screen.queryByText(/may be incomplete/)).not.toBeInTheDocument();
  });

  it("Avg Priority is '—' (not 0.0) when there are no links", () => {
    state.provenance = "live";
    state.rows = [];
    render(<SubstitutesTable substitutes={[]} source="api" />);
    const avg = screen.getByText("Avg Priority").closest(".stat");
    expect(avg?.textContent).toContain("—");
    expect(avg?.textContent).not.toContain("0.0");
  });
});
