import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
// The real view is a client component (useSeededResource/useRouter); stub it so
// this server-component test focuses on the stat-card gating.
vi.mock("./QueryResultsView", () => ({
  QueryResultsView: ({ runs }: { runs: unknown[] }) => <div>query-results:{runs.length}</div>,
}));
vi.mock("./RunQueryForm", () => ({ RunQueryForm: () => <div>run-query-form</div> }));

import AnalyticsQueriesPage from "./page";

const MOCK_RUNS = [
  { id: "r1", queryName: "A", status: "completed", kind: "adhoc", metric: "event_count", metricUnit: "count", dimensions: [], resultRows: 1, rows: [{ value: 1 }], error: null },
  { id: "r2", queryName: "B", status: "failed", kind: "adhoc", metric: "event_count", metricUnit: "count", dimensions: [], resultRows: 0, rows: [], error: "boom" },
];

function mockRuns(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/analytics/queries")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

const statValue = (label: string) =>
  screen.getByText(label).closest(".stat")?.querySelector(".val")?.textContent;

describe("AnalyticsQueriesPage stat cards", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real counts when the loader succeeds", async () => {
    mockRuns({ data: MOCK_RUNS, source: "api" });
    render(await AnalyticsQueriesPage());
    expect(statValue("Runs")).toBe("2");
    expect(statValue("Completed")).toBe("1");
    expect(statValue("Failed")).toBe("1");
  });

  // GAP-ANALYTICS-QUERIES-01
  it("renders — for every stat, not a fabricated zero, when the loader fails", async () => {
    mockRuns({ data: [], source: "error" });
    render(await AnalyticsQueriesPage());
    expect(statValue("Runs")).toBe("—");
    expect(statValue("Completed")).toBe("—");
    expect(statValue("Failed")).toBe("—");
  });

  it("still shows honest zeros (not —) when a tenant genuinely has no runs", async () => {
    mockRuns({ data: [], source: "api" });
    render(await AnalyticsQueriesPage());
    expect(statValue("Runs")).toBe("0");
    expect(statValue("Completed")).toBe("0");
    expect(statValue("Failed")).toBe("0");
  });
});
