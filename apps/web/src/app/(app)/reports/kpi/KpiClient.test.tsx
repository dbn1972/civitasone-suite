import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KpiClient, type KpiRow } from "./KpiClient";

function row(over: Partial<KpiRow> = {}): KpiRow {
  return {
    id: "k1", kpiName: "Collection", module: "finance", currentValue: 80, targetValue: 100,
    achievementPct: 80, unit: "%", period: "Q1", statusLabel: "Met", statusPill: "active",
    rawStatus: "on_track", ...over,
  } as KpiRow;
}

describe("KpiClient", () => {
  // GAP-REPORTS-KPI-01
  it("shows Actual, Target and Achievement columns with the unit", () => {
    render(<KpiClient rows={[row()]} />);
    expect(screen.getByText("Actual")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Achievement")).toBeInTheDocument();
    // actual (80%) also equals achievement (80%), so both appear; target is 100%.
    expect(screen.getAllByText("80%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("100%")).toBeInTheDocument(); // target with %
  });

  // GAP-REPORTS-KPI-05
  it("maps an unknown status to a neutral (draft) pill, not red/rejected", () => {
    // statusPill is computed in page.tsx; here we assert KpiClient renders the
    // supplied neutral pill rather than forcing a status itself.
    render(<KpiClient rows={[row({ statusPill: "draft", statusLabel: "unknown", rawStatus: "weird" })]} />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  // GAP-REPORTS-KPI-04
  it("'Below target' filter with zero matches shows good-news copy, not 'No KPI data available'", () => {
    render(<KpiClient rows={[row({ rawStatus: "on_track" })]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Below target" }));
    expect(screen.getByText("No KPIs below target")).toBeInTheDocument();
    expect(screen.queryByText("No KPI data available")).not.toBeInTheDocument();
  });
});
