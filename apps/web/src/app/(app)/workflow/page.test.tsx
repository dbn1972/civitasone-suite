import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAnalyticsSummaryMock = vi.fn();
vi.mock("./_data/workflowData", () => ({
  getAnalyticsSummary: (...args: unknown[]) => getAnalyticsSummaryMock(...args),
  formatDuration: (s: number | null) => (s === null ? "—" : `${s}s`),
  titleCase: (s: string) => s[0].toUpperCase() + s.slice(1),
  inProgressCount: (byStatus: Record<string, number>) =>
    (byStatus["active"] ?? 0) + (byStatus["pending"] ?? 0) + (byStatus["running"] ?? 0),
  formatBreachRate: (rate: number, tracked: number) =>
    tracked <= 0 ? "—" : `${(rate * 100).toFixed(1)}%`,
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

  // GAP-WORKFLOW-HOME-03: "In progress" counts active + pending + running — the
  // same population the Instances list labels "In progress".
  it("counts active + pending + running for 'In progress'", async () => {
    const a = { ...MOCK_ANALYTICS, instancesByStatus: { active: 2, pending: 3, running: 1, completed: 9 } };
    getAnalyticsSummaryMock.mockResolvedValue({ data: a, source: "api" });
    render(await WorkflowHubPage());
    const label = screen.getByText("In progress");
    const card = label.closest(".stat");
    expect(card?.textContent).toContain("6");
  });

  // GAP-WORKFLOW-HOME-04: a tenant with no SLA-tracked tasks must not print a
  // false clean "0.0%" breach rate.
  it("shows an em dash for breach rate when no SLA-tracked tasks exist", async () => {
    const a = { ...MOCK_ANALYTICS, slaBreachRate: 0, slaTrackedTasks: 0 };
    getAnalyticsSummaryMock.mockResolvedValue({ data: a, source: "api" });
    render(await WorkflowHubPage());
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
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
    expect(screen.getByText("We couldn't load workflow analytics.")).toBeInTheDocument();
    expect(screen.queryByText("No instances yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Total instances")).not.toBeInTheDocument();
  });
});
