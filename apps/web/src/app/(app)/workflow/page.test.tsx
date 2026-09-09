import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAnalyticsSummaryMock = vi.fn();
vi.mock("./_data/workflowData", () => ({
  getAnalyticsSummary: (...args: unknown[]) => getAnalyticsSummaryMock(...args),
  formatDuration: (s: number | null) => (s === null ? "—" : `${s}s`),
  titleCase: (s: string) => s[0].toUpperCase() + s.slice(1),
}));

import WorkflowHubPage from "./page";

const MOCK_ANALYTICS = {
  instancesByStatus: { active: 3, completed: 5 },
  totalInstances: 8,
  avgCycleTimeSeconds: 120,
  completedCount: 5,
  slaBreachRate: 0.1,
  slaBreachedTasks: 1,
  slaTrackedTasks: 10,
  escalations: 0,
};

describe("WorkflowHubPage", () => {
  beforeEach(() => getAnalyticsSummaryMock.mockReset());

  it("renders real analytics and stat counts on success", async () => {
    getAnalyticsSummaryMock.mockResolvedValue({ data: MOCK_ANALYTICS, source: "api" });
    render(await WorkflowHubPage());
    expect(screen.getByText("Total instances")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows the honest 'no instances yet' empty state only for a genuinely empty successful fetch", async () => {
    const empty = { ...MOCK_ANALYTICS, instancesByStatus: {}, totalInstances: 0, completedCount: 0 };
    getAnalyticsSummaryMock.mockResolvedValue({ data: empty, source: "api" });
    render(await WorkflowHubPage());
    expect(screen.getByText("No instances yet")).toBeInTheDocument();
  });

  // UX-001: EMPTY_ANALYTICS (zero instancesByStatus, zero totalInstances) is
  // exactly what a fetch failure returns too — before this fix the "no
  // instances yet" empty state and a real outage rendered identically.
  it("shows the error state — not the 'no instances yet' empty state — on a real fetch failure", async () => {
    const empty = { ...MOCK_ANALYTICS, instancesByStatus: {}, totalInstances: 0, completedCount: 0 };
    getAnalyticsSummaryMock.mockResolvedValue({ data: empty, source: "error" });
    render(await WorkflowHubPage());
    expect(screen.getByText("We couldn't load this workflow analytics.")).toBeInTheDocument();
    expect(screen.queryByText("No instances yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Total instances")).not.toBeInTheDocument();
  });
});
