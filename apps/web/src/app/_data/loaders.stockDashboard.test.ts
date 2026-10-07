import { describe, it, expect } from "vitest";
import { mapStockDashboard } from "./loaders";

// GAP-STOCK-DASHBOARD-02: a dashboard field that is not a number is a broken
// payload, not a real zero. mapStockDashboard must return null so fetchJson
// reports source:"error" and the page shows an honest error/"—" state rather
// than fabricated zeros (a hidden low-stock/stock-out count masks a stock-out).
describe("mapStockDashboard (GAP-STOCK-DASHBOARD-02/04)", () => {
  it("returns null when a required numeric field is missing", () => {
    expect(mapStockDashboard({ totalSKUs: 10, lowStockAlerts: 1, grnsThisMonth: 2 })).toBeNull();
  });

  it("returns null when a field is not a number", () => {
    expect(mapStockDashboard({ totalSKUs: "10", lowStockAlerts: 1, grnsThisMonth: 2, inventoryValue: 500 })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(mapStockDashboard(null)).toBeNull();
    expect(mapStockDashboard("boom")).toBeNull();
  });

  it("maps a healthy payload including stockOuts (GAP-STOCK-DASHBOARD-04)", () => {
    expect(
      mapStockDashboard({ totalSKUs: 10, lowStockAlerts: 1, stockOuts: 3, grnsThisMonth: 2, inventoryValue: 500 }),
    ).toEqual({ totalSKUs: 10, lowStockAlerts: 1, stockOuts: 3, grnsThisMonth: 2, inventoryValue: 500 });
  });

  it("defaults stockOuts to 0 when an older backend omits it (does not fail the whole payload)", () => {
    expect(
      mapStockDashboard({ totalSKUs: 10, lowStockAlerts: 1, grnsThisMonth: 2, inventoryValue: 500 }),
    ).toEqual({ totalSKUs: 10, lowStockAlerts: 1, stockOuts: 0, grnsThisMonth: 2, inventoryValue: 500 });
  });

  it("preserves a genuine zero (real 0 low-stock is kept, not treated as an error)", () => {
    const r = mapStockDashboard({ totalSKUs: 0, lowStockAlerts: 0, stockOuts: 0, grnsThisMonth: 0, inventoryValue: 0 });
    expect(r).not.toBeNull();
    expect(r!.lowStockAlerts).toBe(0);
  });
});
