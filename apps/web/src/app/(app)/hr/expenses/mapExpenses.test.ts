import { describe, it, expect } from "vitest";
import { mapExpenses } from "./mapExpenses";

function apiExpense(overrides: Partial<Parameters<typeof mapExpenses>[0][number]> = {}) {
  return {
    id: "e1",
    category: "travel",
    amount: 45000,
    description: "Auto fare",
    date: "2025-04-15",
    status: "pending",
    created_at: "2025-04-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("mapExpenses — GAP-HR-EXPENSES-05 category/date display", () => {
  it("humanizes a lowercase category enum ('travel' -> 'Travel')", () => {
    const [row] = mapExpenses([apiExpense({ category: "travel" })]);
    expect(row.category).toBe("Travel");
  });

  it("humanizes a multi-word category enum ('office_supplies'-style snake_case)", () => {
    const [row] = mapExpenses([apiExpense({ category: "stationery" })]);
    expect(row.category).toBe("Stationery");
  });

  it("falls back to '—' when category is missing or empty, never a blank string", () => {
    const [row] = mapExpenses([apiExpense({ category: "" })]);
    expect(row.category).toBe("—");
  });

  it("keeps the raw ISO date untouched (not pre-formatted to 'DD Mon YYYY') so DataTable's cellType:\"date\" sort stays chronological", () => {
    const [row] = mapExpenses([apiExpense({ date: "2025-04-15" })]);
    expect(row.date).toBe("2025-04-15");
  });

  it("falls back to created_at when date is absent", () => {
    const [row] = mapExpenses([apiExpense({ date: undefined as unknown as string, created_at: "2025-04-15T00:00:00.000Z" })]);
    expect(row.date).toBe("2025-04-15T00:00:00.000Z");
  });

  it("maps to null (never a fabricated date string) when both date and created_at are missing — DataTable's cellType:\"date\" renders this as '—' (see formatIndianDate's own null-case tests in formatters.test.ts)", () => {
    const [row] = mapExpenses([apiExpense({ date: undefined as unknown as string, created_at: undefined as unknown as string })]);
    expect(row.date).toBeNull();
  });

  it("defaults a missing amount/description sanely instead of throwing", () => {
    const [row] = mapExpenses([apiExpense({ amount: undefined as unknown as number, description: undefined as unknown as string })]);
    expect(row.amount).toBe(0);
    expect(row.description).toBe("—");
  });
});
