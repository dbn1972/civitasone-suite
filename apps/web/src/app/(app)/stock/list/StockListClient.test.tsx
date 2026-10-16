/**
 * GAP-STOCK-LIST-03: stockStatus distinguishes out/low/ok; new items (0/0) not flagged low.
 * GAP-STOCK-LIST-06: statusLabel is a proper string, no `as unknown as boolean` cast.
 * GAP-STOCK-LIST-07: Category column rendered.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StockListClient } from "./StockListClient";

const BASE = {
  id: "aaa",
  itemCode: "INK-001",
  name: "Printer Ink",
  category: "Stationery",
  unit: "EA",
  totalValue: 50000,
};

describe("GAP-STOCK-LIST-03: stock status computation", () => {
  it("new item with stock=0 and min=0 shows Out of stock status pill", () => {
    render(
      <StockListClient
        items={[{ ...BASE, currentStock: 0, isLowStock: false, stockStatus: "out" }]}
      />
    );
    // The status pill should say "Out of stock", not "Low stock"
    const cells = document.querySelectorAll("td .pill");
    const pillTexts = Array.from(cells).map((el) => el.textContent ?? "");
    expect(pillTexts.some((t) => t === "Out of stock")).toBe(true);
    expect(pillTexts.some((t) => t === "Low stock")).toBe(false);
  });

  it("item with currentStock=3 and min=5 shows Low stock pill", () => {
    render(
      <StockListClient
        items={[{ ...BASE, currentStock: 3, isLowStock: true, stockStatus: "low" }]}
      />
    );
    const cells = document.querySelectorAll("td .pill");
    const pillTexts = Array.from(cells).map((el) => el.textContent ?? "");
    expect(pillTexts.some((t) => t === "Low stock")).toBe(true);
  });

  it("item with adequate stock shows OK pill", () => {
    render(
      <StockListClient
        items={[{ ...BASE, currentStock: 20, isLowStock: false, stockStatus: "ok" }]}
      />
    );
    const cells = document.querySelectorAll("td .pill");
    const pillTexts = Array.from(cells).map((el) => el.textContent ?? "");
    expect(pillTexts.some((t) => t === "OK")).toBe(true);
  });
});

describe("GAP-STOCK-LIST-06: status column uses string label, no boolean cast", () => {
  it("Out of stock filter shows only out-of-stock rows", () => {
    render(
      <StockListClient
        items={[
          { ...BASE, id: "a1", name: "Item A", currentStock: 0, isLowStock: false, stockStatus: "out" },
          { ...BASE, id: "a2", name: "Item B", currentStock: 3, isLowStock: true, stockStatus: "low" },
          { ...BASE, id: "a3", name: "Item C", currentStock: 20, isLowStock: false, stockStatus: "ok" },
        ]}
      />
    );
    // Click the "Out of stock" segment button
    fireEvent.click(screen.getByRole("tab", { name: "Out of stock" }));
    // After filtering Item A should be visible, B and C should not
    expect(screen.getByText("Item A")).toBeTruthy();
    expect(screen.queryByText("Item B")).toBeNull();
    expect(screen.queryByText("Item C")).toBeNull();
  });
});

describe("GAP-STOCK-LIST-07: Category column", () => {
  it("renders the Category column header", () => {
    render(
      <StockListClient
        items={[{ ...BASE, currentStock: 10, isLowStock: false, stockStatus: "ok" }]}
      />
    );
    expect(screen.getByText("Category")).toBeTruthy();
    expect(screen.getByText("Stationery")).toBeTruthy();
  });
});
