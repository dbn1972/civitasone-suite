import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-INVENTORY-LOW-STOCK-02/-03, RESERVATIONS-02/-03, SUBSTITUTES-03: the
 * register bodies. useSeededResource is stubbed to hand back the seeded rows.
 */
const state: { rows: unknown[] } = { rows: [] };
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initial: unknown[]) => ({
    data: state.rows.length > 0 ? state.rows : initial,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: "live",
  }),
}));

const { LowStockTable } = await import("./LowStockTable");
const { ReservationsTable } = await import("./ReservationsTable");
const { SubstitutesTable } = await import("./SubstitutesTable");

const ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const STORE = "cccccccc-0000-4000-8000-000000000003";

beforeEach(() => {
  state.rows = [];
});

describe("low stock (GAP-INVENTORY-LOW-STOCK-02 / -03)", () => {
  const row = (over: object) => ({
    itemId: ID_A, storeId: STORE, name: "Gel pen", sku: "PEN-01", storeName: "Main Store",
    onHandQty: 0, reorderLevel: 10, suggestedReorderQty: 40, ...over,
  });

  it("shows the store, a per-row severity, an item link and a prefilled Raise indent link", () => {
    state.rows = [row({}), row({ itemId: ID_B, name: "Stapler", sku: null, onHandQty: 8 })];
    render(<LowStockTable rows={[]} source="api" />);
    expect(screen.getAllByText("Main Store").length).toBe(2);
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.queryByText("LOW")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gel pen" })).toHaveAttribute("href", `/inventory/${ID_A}`);
    const raise = screen.getAllByRole("link", { name: "Raise indent" })[0];
    const url = new URL(raise.getAttribute("href") ?? "", "http://x");
    expect(url.pathname).toBe("/procurement/indents/new");
    expect(url.searchParams.get("itemCode")).toBe("PEN-01");
    expect(url.searchParams.get("quantity")).toBe("40");
  });

  it("a healthy empty list says nothing is below reorder level", () => {
    render(<LowStockTable rows={[]} source="api" />);
    expect(screen.getByText("No items below reorder level")).toBeInTheDocument();
  });
});

describe("reservations (GAP-INVENTORY-RESERVATIONS-02 / -03)", () => {
  const res = (over: object) => ({
    id: "r", itemId: ID_A, storeId: STORE, qty: 5, refType: "indent", refId: ID_B, status: "active",
    expiresAt: null, createdAt: "2026-08-01", itemName: "Gel pen", itemSku: "PEN-01", storeName: "Main Store", ...over,
  });

  it("Qty Held counts only active holds: 5 active + 3 released => 5", () => {
    state.rows = [res({ id: "1" }), res({ id: "2", qty: 3, status: "released" })];
    render(<ReservationsTable reservations={[]} source="api" />);
    const held = screen.getByText("Qty Held (active)").closest(".stat");
    expect(held?.textContent).toContain("5");
    expect(held?.textContent).not.toContain("8");
    const activeStat = screen.getAllByText("Active").map((el) => el.closest(".stat")).find(Boolean);
    expect(activeStat?.textContent).toContain("1");
  });

  it("shows the item name linked to its page and the store name", () => {
    state.rows = [res({})];
    render(<ReservationsTable reservations={[]} source="api" />);
    expect(screen.getByRole("link", { name: "PEN-01 \u00b7 Gel pen" })).toHaveAttribute("href", `/inventory/${ID_A}`);
    expect(screen.getByText("Main Store")).toBeInTheDocument();
  });

  it("an unnamed item and store fall back to short ids without crashing", () => {
    state.rows = [res({ itemName: null, itemSku: null, storeName: null })];
    render(<ReservationsTable reservations={[]} source="api" />);
    expect(screen.getByRole("link", { name: ID_A.slice(0, 8) })).toBeInTheDocument();
    expect(screen.getByTitle(STORE)).toHaveTextContent(STORE.slice(0, 8));
  });
});

describe("substitutes (GAP-INVENTORY-SUBSTITUTES-03)", () => {
  const sub = (over: object) => ({
    id: "s", itemId: ID_A, substituteId: ID_B, priority: 1, conversionFactor: "1.500000", createdAt: "2026-08-01",
    itemName: "Gel pen", itemSku: "PEN-01", substituteName: "Ball pen", substituteSku: null, ...over,
  });

  it("names and links both ends and formats the conversion factor", () => {
    state.rows = [sub({})];
    render(<SubstitutesTable substitutes={[]} source="api" />);
    expect(screen.getByRole("link", { name: "PEN-01 \u00b7 Gel pen" })).toHaveAttribute("href", `/inventory/${ID_A}`);
    expect(screen.getByRole("link", { name: "Ball pen" })).toHaveAttribute("href", `/inventory/${ID_B}`);
    expect(screen.getByText("1 : 1.5")).toBeInTheDocument();
    expect(screen.queryByText("1.500000")).not.toBeInTheDocument();
  });

  it("an un-named substitute shows a short id and a non-numeric factor stays raw", () => {
    state.rows = [sub({ substituteName: null, conversionFactor: "n/a" })];
    render(<SubstitutesTable substitutes={[]} source="api" />);
    expect(screen.getByRole("link", { name: ID_B.slice(0, 8) })).toHaveAttribute("title", ID_B);
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });
});
