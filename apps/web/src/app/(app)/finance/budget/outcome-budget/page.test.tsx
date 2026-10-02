import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getOutcomes = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceOutcomeBudget: () => getOutcomes() }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));

import OutcomeBudgetPage from "./page";

const outcome = (id: string, bps: unknown, o: Record<string, unknown> = {}) => ({
  id, headId: "h", fy: "2026-27", allocationId: null, schemeId: null, outputDesc: "o", outcomeDesc: `Outcome ${id}`,
  indicator: `Ind ${id}`, unit: "days", baselineValue: "0", targetValue: "30", achievedValue: "15", achievementBps: bps,
  allocatedMinor: "0", currency: "INR", status: "active", ...o,
});

describe("OutcomeBudgetPage", () => {
  beforeEach(() => getOutcomes.mockReset());
  const card = (label: string) => screen.getAllByText(label).find((e) => !e.closest("table"))!.parentElement!.textContent ?? "";

  // GAP-FINANCE-BUDGET-OUTCOME-BUDGET-03
  it("splits not measured / not started / in progress / achieved explicitly", async () => {
    getOutcomes.mockResolvedValue({
      data: [outcome("a", null), outcome("b", "0"), outcome("c", "5000"), outcome("d", "10000"), outcome("e", "-10")],
      source: "api",
    });
    render(await OutcomeBudgetPage());
    expect(card("Not Measured")).toContain("1");
    expect(card("Not Started")).toContain("2");
    expect(card("In Progress")).toContain("1");
    expect(card("Achieved")).toContain("1");
  });

  it("table shows — (not 0.0%) for a missing measurement", async () => {
    getOutcomes.mockResolvedValue({ data: [outcome("a", null)], source: "api" });
    render(await OutcomeBudgetPage());
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.getByTitle("No measurement recorded yet")).toHaveTextContent("—");
  });

  it("no Not Measured card when every outcome has a measurement", async () => {
    getOutcomes.mockResolvedValue({ data: [outcome("a", "5000")], source: "api" });
    render(await OutcomeBudgetPage());
    expect(screen.queryByText("Not Measured")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02
  it("Target and Achieved carry the indicator's unit: 30 days / 15 days", async () => {
    getOutcomes.mockResolvedValue({ data: [outcome("a", "5000")], source: "api" });
    render(await OutcomeBudgetPage());
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("15 days")).toBeInTheDocument();
  });

  // GAP-FINANCE-BUDGET-OUTCOME-BUDGET-04
  it("% Done renders a progress bar plus the exact percentage with the formula as a tooltip", async () => {
    getOutcomes.mockResolvedValue({ data: [outcome("a", "7550")], source: "api" });
    const { container } = render(await OutcomeBudgetPage());
    expect(screen.getByText("75.5%")).toBeInTheDocument();
    expect(container.querySelector(".bar i")).toHaveStyle({ width: "75.5%" });
    expect(screen.getByTitle(/Achievement = /)).toBeInTheDocument();
  });

  it("error state unchanged: — cards and retry", async () => {
    getOutcomes.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await OutcomeBudgetPage());
    expect(screen.getAllByText("—").length).toBe(4);
  });
});
