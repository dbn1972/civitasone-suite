import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("./BudgetChart", () => ({ BudgetChart: () => <div>budget-chart</div> }));
vi.mock("../_components/PrintExportButton", () => ({ PrintExportButton: () => <button>export</button> }));
vi.mock("../_components/FyFilter", () => ({ FyFilter: () => <div>fy-filter</div> }));

import FinanceDashboardPage from "./page";

const MOCK_DASHBOARD = {
  budgetUtilisationPct: 62.5,
  pendingSanctions: 7,
  paymentsThisMonth: 41,
  totalExpenditure: 12_500_000,
};

function mockFinanceLoader(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/finance/dashboard")) return Promise.resolve(result);
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("FinanceDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real formatted stat values when the loader succeeds", async () => {
    mockFinanceLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await FinanceDashboardPage());
    // Labels come back as their raw translation key under the mocked
    // getTranslations, so look up each stat by that key and assert on its
    // own card rather than on the value text directly -- "62.5%" is both
    // budgetUtilisation's value AND expenditureYtd's delta, so a bare
    // getByText("62.5%") would ambiguously match two elements.
    expect(screen.getByText("budgetUtilisation").closest(".stat")).toHaveTextContent("62.5%");
    expect(screen.getByText("pendingApprovals").closest(".stat")).toHaveTextContent("7");
  });

  it("renders — for every stat, not a fabricated zero, when the loader fails", async () => {
    // Bug A / UX-013: `source` was already fetched here but only wired to
    // the DataSourceBadge -- never to the stat values -- so a failed load
    // rendered the loader's zero-valued fallback defaults ("₹0.00", "0
    // payments this month", "0") indistinguishable from a genuine zero.
    mockFinanceLoader({
      data: { budgetUtilisationPct: null, pendingSanctions: 0, paymentsThisMonth: 0, totalExpenditure: 0 },
      source: "error",
    });
    render(await FinanceDashboardPage());
    const dashes = screen.getAllByText("—");
    // budgetUtilisation, expenditureYtd, paymentsMtd, pendingApprovals
    expect(dashes.length).toBe(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});
