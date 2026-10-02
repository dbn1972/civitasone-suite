import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getBudgets = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceBudgets: () => getBudgets() }));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import BudgetFormulationPage from "./page";

function budget(id: string, fy: string, beMinor: string, sanctioned: string) {
  return {
    id, majorHead: `MH-${id}`, subHead: `Head ${id}`, sanctionedAmount: sanctioned, releasedAmount: "0",
    expenditure: "0", balance: "0", beMinor, reMinor: beMinor, status: "pending", financialYear: fy,
  };
}

describe("BudgetFormulationPage", () => {
  beforeEach(() => getBudgets.mockReset());

  // GAP-FINANCE-BUDGET-FORMULATION-02
  it("totals the selected FY's proposed BE only (not every year's sanctioned RE)", async () => {
    getBudgets.mockResolvedValue({
      data: [
        budget("a", "2026-27", "123456789", "999900000"),
        budget("b", "2025-26", "500000000", "500000000"),
      ],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("Proposed Outlay (BE, FY 2026-27)")).toBeInTheDocument();
    expect(screen.getByText("₹12,34,567.89")).toBeInTheDocument();
    expect(screen.getByText("Budget estimates (BE) — FY 2026-27")).toBeInTheDocument();
    expect(screen.queryByText("MH-b")).not.toBeInTheDocument();
  });

  it("ignores a malformed ?fy= and falls back to a valid FY label", async () => {
    getBudgets.mockResolvedValue({ data: [], source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-99" } }));
    expect(screen.queryByText(/FY 2026-99/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-BUDGET-FORMULATION-03
  it("on a failed fetch shows — cards and a Retry state, not ₹0.00 / No records", async () => {
    getBudgets.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("We couldn't load budget estimates.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("a genuinely empty FY still shows zeros, no error", async () => {
    getBudgets.mockResolvedValue({ data: [], source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't load/)).not.toBeInTheDocument();
  });
});
