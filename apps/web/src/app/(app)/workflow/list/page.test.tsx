import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getInstancesMock = vi.fn();
const getAnalyticsSummaryMock = vi.fn();

vi.mock("../_data/workflowData", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../_data/workflowData");
  return {
    ...actual,
    getInstances: (...a: unknown[]) => getInstancesMock(...a),
    getAnalyticsSummary: (...a: unknown[]) => getAnalyticsSummaryMock(...a),
  };
});

// RefreshErrorState / InstancesTable are client components using next/navigation.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workflow/list",
}));

import WorkflowInstancesPage from "./page";

const EMPTY_ANALYTICS = {
  instancesByStatus: {},
  totalInstances: 0,
  avgCycleTimeSeconds: null,
  completedCount: 0,
  slaBreachRate: 0,
  slaBreachedTasks: 0,
  slaTrackedTasks: 0,
  escalations: 0,
};

function instance(id: string, over: Record<string, unknown> = {}) {
  return { id, name: `Instance ${id}`, status: "active", version: 1, ...over };
}

describe("WorkflowInstancesPage — GAP-WORKFLOW-LIST-01/02", () => {
  beforeEach(() => {
    getInstancesMock.mockReset();
    getAnalyticsSummaryMock.mockReset();
  });

  it("shows '—' for all four stats (not fabricated zeros) when analytics fails but the table still renders", async () => {
    getInstancesMock.mockResolvedValue({ data: [instance("a"), instance("b")], source: "api" });
    getAnalyticsSummaryMock.mockResolvedValue({ data: EMPTY_ANALYTICS, source: "error" });

    render(await WorkflowInstancesPage());

    // Four stat tiles all read "—" on analytics failure.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    // The table still renders its rows.
    expect(screen.getByText("Instance a")).toBeInTheDocument();
  });

  it("uses the authoritative analytics total (no rows.length fallback) on success", async () => {
    getInstancesMock.mockResolvedValue({ data: [instance("a")], source: "api" });
    getAnalyticsSummaryMock.mockResolvedValue({
      data: { ...EMPTY_ANALYTICS, totalInstances: 500, instancesByStatus: { active: 10, completed: 480, cancelled: 10 } },
      source: "api",
    });

    render(await WorkflowInstancesPage());
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows a Try again action (RefreshErrorState) when the instances fetch itself fails", async () => {
    getInstancesMock.mockResolvedValue({ data: [], source: "error" });
    getAnalyticsSummaryMock.mockResolvedValue({ data: EMPTY_ANALYTICS, source: "error" });

    render(await WorkflowInstancesPage());
    expect(screen.getByText("We couldn't load instances.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
