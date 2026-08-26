import { describe, it, expect, vi, beforeEach } from "vitest";

const getSummary = vi.fn();
const getLines = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getFinanceBudgetMonitoring: (fy?: string) => getSummary(fy),
  getFinanceBudgetMonitoringLines: (fy?: string) => getLines(fy),
}));
// FyFilter is a client component (next/navigation hooks); stub for server invoke.
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));

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
