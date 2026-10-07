import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));

import { QueryResultsView } from "./QueryResultsView";
import type { AnalyticsQueryRunRow } from "../_data";

function run(partial: Partial<AnalyticsQueryRunRow>): AnalyticsQueryRunRow {
  return {
    id: "r1",
    queryName: "Q1",
    status: "completed",
    kind: "adhoc",
    metric: "event_count",
    metricUnit: "count",
    dimensions: [],
    resultRows: 1,
    rows: [{ value: 10 }],
    error: null,
    ...partial,
  };
}

function seed(rows: AnalyticsQueryRunRow[], provenance = "live") {
  resourceMock.mockReturnValue({ data: rows, provenance, offline: false, cachedAt: null, fromCache: false });
}

describe("QueryResultsView", () => {
  beforeEach(() => {
    resourceMock.mockReset();
    refreshMock.mockReset();
    vi.useRealTimers();
  });
  afterEach(() => vi.useRealTimers());

  // GAP-ANALYTICS-QUERIES-02
  it("shows the failure reason for a failed run", () => {
    seed([run({ id: "f1", status: "failed", error: "Timeout", rows: [] })]);
    render(<QueryResultsView runs={[]} source="api" />);
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("does not show error text for a completed run", () => {
    seed([run({ id: "c1", status: "completed", error: null })]);
    render(<QueryResultsView runs={[]} source="api" />);
    expect(screen.queryByText("Timeout")).not.toBeInTheDocument();
  });

  // GAP-ANALYTICS-QUERIES-04: money metric renders ₹ not a bare integer.
  it("renders a paise metric value as rupees in the result table", () => {
    seed([
      run({
        id: "m1",
        status: "completed",
        metric: "amount_sum",
        metricUnit: "paise",
        dimensions: ["source"],
        rows: [{ source: "revenue", value: 12345 }],
      }),
    ]);
    render(<QueryResultsView runs={[]} source="api" />);
    // 12345 paise => ₹123.45
    expect(screen.getAllByText("₹123.45").length).toBeGreaterThan(0);
    // The value column header is the metric key/label, not the fixed word "Value".
    expect(screen.queryByText("Value")).not.toBeInTheDocument();
    expect(screen.getAllByText("amount_sum").length).toBeGreaterThan(0);
  });

  it("renders a count metric value as a plain integer, not currency", () => {
    seed([run({ id: "k1", status: "completed", metric: "event_count", metricUnit: "count", rows: [{ value: 2500 }] })]);
    render(<QueryResultsView runs={[]} source="api" />);
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(screen.getAllByText("2,500").length).toBeGreaterThan(0);
  });

  // GAP-ANALYTICS-QUERIES-01: error with no cache -> retry UI, no empty table.
  it("shows a retry affordance when provenance is error-no-data", () => {
    seed([], "error-no-data");
    render(<QueryResultsView runs={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  // GAP-ANALYTICS-QUERIES-03: a pending run schedules a polling refresh.
  it("polls router.refresh while a run is still pending and stops when none remain", () => {
    vi.useFakeTimers();
    seed([run({ id: "p1", status: "running", rows: [] })]);
    const { rerender } = render(<QueryResultsView runs={[]} source="api" />);
    expect(refreshMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(refreshMock).toHaveBeenCalledTimes(2);

    // Run resolves -> polling stops.
    seed([run({ id: "p1", status: "completed", rows: [{ value: 1 }] })]);
    rerender(<QueryResultsView runs={[]} source="api" />);
    refreshMock.mockClear();
    vi.advanceTimersByTime(15000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not poll when all runs are terminal", () => {
    vi.useFakeTimers();
    seed([run({ id: "d1", status: "completed", rows: [{ value: 1 }] })]);
    render(<QueryResultsView runs={[]} source="api" />);
    vi.advanceTimersByTime(20000);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
