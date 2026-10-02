import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getSummary = vi.fn();
const getLines = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getFinanceBudgetMonitoring: (fy?: string) => getSummary(fy),
  getFinanceBudgetMonitoringLines: (fy?: string) => getLines(fy),
}));
// FyFilter is a client component (next/navigation hooks); stub for server invoke.
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));

// Isolate rendering from the offline cache layer (same stub as MonitoringTable.test.tsx).
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import BudgetMonitoringPage from "./page";

const EMPTY_SUMMARY = { data: { totals: { count: 0, exceptions: {} } }, source: "api" as const };
const EMPTY_LINES = { data: [], source: "api" as const };

/**
 * L1/L3: /finance/budget/monitoring called its loaders with no fy, but the
 * budget-monitoring endpoints REQUIRE ?fy= (HTTP 400 otherwise) — so the page
 * always errored to a screen of misleading ₹0 / 0-exception zeros.
 */
describe("BudgetMonitoringPage always sends the required fy", () => {
  beforeEach(() => {
    getSummary.mockReset().mockResolvedValue(EMPTY_SUMMARY);
    getLines.mockReset().mockResolvedValue(EMPTY_LINES);
  });

  it("defaults to the current financial year when the URL has no fy", async () => {
    await BudgetMonitoringPage({ searchParams: {} });
    expect(getSummary).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(getLines).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
  });

  it("honours an explicit fy from the URL", async () => {
    await BudgetMonitoringPage({ searchParams: { fy: "2024-25" } });
    expect(getSummary).toHaveBeenCalledWith("2024-25");
    expect(getLines).toHaveBeenCalledWith("2024-25");
  });
});

/**
 * GAP-FINANCE-BUDGET-MONITORING-01: summary and lines each own their error
 * state -- the 2x2 matrix of which fetch failed.
 */
describe("BudgetMonitoringPage error states (GAP-FINANCE-BUDGET-MONITORING-01)", () => {
  const OK_SUMMARY = {
    data: { fy: "2026-27", fractionElapsedBps: "5000", totals: { count: 1, allocatedMinor: "1000000", committedMinor: "0", actualMinor: "250000", availableMinor: "750000", forecastYearEndMinor: "500000", exceptions: {} } },
    source: "api" as const,
  };
  const LINE = { id: "l1", headId: "11111111-1111-4111-8111-111111111111", headCode: "2202", headName: "General Education", fy: "2026-27", allocatedMinor: "1000000", committedMinor: "50000", actualMinor: "250000", availableMinor: "750000", burnRateBps: "0", utilisationBps: "2500", forecastYearEndMinor: "0", exception: "on_track" };

  async function show(summary: unknown, lines: unknown) {
    getSummary.mockReset().mockResolvedValue(summary);
    getLines.mockReset().mockResolvedValue(lines);
    render(await BudgetMonitoringPage({ searchParams: { fy: "2026-27" } }));
  }

  it("lines error + summary ok: error state in the table area, never the empty-lines copy", async () => {
    await show(OK_SUMMARY, { data: [], source: "error", status: 500 });
    expect(screen.getByText("We couldn't load budget monitoring lines.")).toBeInTheDocument();
    expect(screen.queryByText(/No budget allocation lines found/)).not.toBeInTheDocument();
    expect(screen.queryByText("We couldn't load budget monitoring totals.")).not.toBeInTheDocument();
  });

  it("summary error + lines ok: cards show — (no ₹0) and the rows still render", async () => {
    await show({ data: EMPTY_SUMMARY.data, source: "error", status: 500 }, { data: [LINE], source: "api" });
    expect(screen.getByText("We couldn't load budget monitoring totals.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();
    expect(screen.getByText("2202 · General Education")).toBeInTheDocument();
  });

  it("both ok and empty: legitimate empty copy, no error state", async () => {
    await show(EMPTY_SUMMARY, EMPTY_LINES);
    expect(screen.getByText(/No budget allocation lines found/)).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't load/)).not.toBeInTheDocument();
  });
});
