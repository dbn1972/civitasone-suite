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
    // the card (and the row's BE cell) show this FY's BE total
    expect(screen.getAllByText("₹12,34,567.89").length).toBeGreaterThan(0);
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

// GAP-FINANCE-BUDGET-FORMULATION-01/-04/-05
describe("BudgetFormulationPage -- column meaning, counts, vocabulary", () => {
  beforeEach(() => getBudgets.mockReset());
  const full = (o: Record<string, unknown>) => ({
    id: "x", majorHead: "2202", subHead: "Edu", sanctionedAmount: "500000", releasedAmount: "200000",
    expenditure: "0", balance: "0", beMinor: "1000000", reMinor: "1000000", status: "approved", financialYear: "2026-27", ...o,
  });

  it("each money column shows the field it is named for (BE=beMinor, Sanctioned, Released)", async () => {
    getBudgets.mockResolvedValue({ data: [full({})], source: "api" });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    const row = screen.getByText("2202").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((c) => c.textContent);
    const header = Array.from(row.closest("table")!.querySelectorAll("th")).map((c) => c.textContent?.replace(/[▲▼↕]/g, "").trim());
    const at = (label: string) => cells[header.findIndex((h) => h?.startsWith(label))];
    expect(at("Budget Estimate (BE)")).toBe("₹10,000.00");
    expect(at("Sanctioned")).toBe("₹5,000.00");
    expect(at("Released")).toBe("₹2,000.00");
  });

  it("Last Year (BE) is the previous FY's BE for the same head, or — when absent", async () => {
    getBudgets.mockResolvedValue({
      data: [
        full({ id: "cur", majorHead: "2202", beMinor: "1000000" }),
        full({ id: "prev", majorHead: "2202", financialYear: "2025-26", beMinor: "700000", sanctionedAmount: "1", releasedAmount: "1" }),
        full({ id: "new", majorHead: "3333", subHead: "Roads", beMinor: "1" }),
      ],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    const header = Array.from(screen.getAllByRole("columnheader")).map((c) => c.textContent?.replace(/[▲▼↕]/g, "").trim());
    const idx = header.findIndex((h) => h === "Last Year (BE)");
    const lastYear = (head: string) => screen.getByText(head).closest("tr")!.querySelectorAll("td")[idx].textContent;
    expect(lastYear("2202")).toBe("₹7,000.00");
    expect(lastYear("3333")).toBe("—");
  });

  it("a head repeated in the current FY gets last year's BE once, not on every row", async () => {
    getBudgets.mockResolvedValue({
      data: [
        full({ id: "c1", beMinor: "100" }),
        full({ id: "c2", beMinor: "200" }),
        full({ id: "p", financialYear: "2025-26", beMinor: "700000" }),
      ],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    const header = Array.from(screen.getAllByRole("columnheader")).map((c) => c.textContent?.replace(/[▲▼↕]/g, "").trim());
    const idx = header.findIndex((h) => h === "Last Year (BE)");
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[idx]?.textContent);
    expect(cells.filter((c) => c === "₹7,000.00").length).toBe(1);
  });

  it("Major Heads delta says approved N (matching the filter), and the card/tab share the word 'Pending'", async () => {
    getBudgets.mockResolvedValue({
      data: [full({ id: "a" }), full({ id: "b", majorHead: "2203" }), full({ id: "c", majorHead: "2204", status: "submitted" })],
      source: "api",
    });
    render(await BudgetFormulationPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("approved 2")).toBeInTheDocument();
    expect(screen.queryByText("Pending Review")).not.toBeInTheDocument();
    // card label "Pending" + tab "Pending"
    expect(screen.getAllByText("Pending").length).toBe(2);
  });
});

