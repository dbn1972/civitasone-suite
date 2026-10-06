import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsView } from "./AnalyticsView";

// GAP-JOURNEYS-ANALYTICS-01: the analytics page shows at least completion
// counts distinct from the Active table; an error source shows retry, not zeros.
describe("AnalyticsView", () => {
  it("shows total / running / completed stat figures", () => {
    render(
      <AnalyticsView
        analytics={{
          total: 10,
          running: 4,
          completed: 5,
          failed: 1,
          byStatus: [
            { status: "completed", count: 5 },
            { status: "in_progress", count: 4 },
            { status: "failed", count: 1 },
          ],
        }}
        source="api"
      />,
    );
    expect(screen.getByText("Total executions")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Completion rate")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument(); // 5/10
    // a bar chart is rendered (not the raw Active list)
    expect(screen.getByRole("img", { name: /by status/i })).toBeInTheDocument();
  });

  it("shows a retry error state (not zeros) when source is error", () => {
    render(
      <AnalyticsView
        analytics={{ total: 0, running: 0, completed: 0, failed: 0, byStatus: [] }}
        source="error"
      />,
    );
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText("Total executions")).not.toBeInTheDocument();
  });
});
