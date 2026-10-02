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
vi.mock("../_components/PrintExportButton", () => ({ PrintExportButton: ({ label }: { label?: string }) => <button>{label ?? "export"}</button> }));
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
    render(await FinanceDashboardPage({}));
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
    render(await FinanceDashboardPage({}));
    const dashes = screen.getAllByText("—");
    // budgetUtilisation, expenditureYtd, paymentsMtd, pendingApprovals
    expect(dashes.length).toBe(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-DASHBOARD-02: the FY selector must actually drive the loader.
  it("passes the selected fiscal year to the dashboard endpoint and shows it", async () => {
    mockFinanceLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await FinanceDashboardPage({ searchParams: { fy: "2025-26" } }));
    const paths = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("/api/v1/finance/dashboard?fy=2025-26"))).toBe(true);
    expect(screen.getByText(/FY 2025-26/)).toBeInTheDocument();
  });

  it("ignores an unrecognised fy value instead of forwarding it", async () => {
    mockFinanceLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await FinanceDashboardPage({ searchParams: { fy: "1999-00; drop" } }));
    const paths = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("drop"))).toBe(false);
  });

  // GAP-FINANCE-DASHBOARD-03
  it("never shows the same percentage twice and has no hard-coded 'Approved' caption", async () => {
    mockFinanceLoader({ data: MOCK_DASHBOARD, source: "api" });
    const { container } = render(await FinanceDashboardPage({}));
    expect(screen.getAllByText("62.5%")).toHaveLength(1);
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    expect(container.querySelector(".delta")).toBeNull();
  });

  // GAP-FINANCE-DASHBOARD-05
  it("on a failed load renders retry state instead of a zero chart", async () => {
    mockFinanceLoader({ data: { budgetUtilisationPct: null, pendingSanctions: 0, paymentsThisMonth: 0, totalExpenditure: 0 }, source: "error" });
    render(await FinanceDashboardPage({}));
    expect(screen.queryByText("budget-chart")).not.toBeInTheDocument();
    expect(screen.getAllByText(/couldn't load/i).length).toBeGreaterThan(0);
    // Quick-link tiles stay: they are navigation, not data.
    expect(screen.getByText("Sanctions")).toBeInTheDocument();
  });

  it("a healthy load still renders the chart", async () => {
    mockFinanceLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await FinanceDashboardPage({}));
    expect(screen.getByText("budget-chart")).toBeInTheDocument();
  });

  // GAP-FINANCE-DASHBOARD-06
  it("labels the button Print (not Export MIS) and keeps the tiles and FY filter out of print", async () => {
    mockFinanceLoader({ data: MOCK_DASHBOARD, source: "api" });
    const { container } = render(await FinanceDashboardPage({}));
    expect(screen.queryByText(/Export MIS|exportMis/)).not.toBeInTheDocument();
    expect(screen.getByText("printPage")).toBeInTheDocument(); // translation key under the mocked getTranslations
    expect(screen.getByText("Sanctions").closest(".no-print")).not.toBeNull();
    expect(screen.getByText("fy-filter").closest(".no-print")).not.toBeNull();
    expect(container.querySelector(".print-header")).not.toBeNull();
  });
});
