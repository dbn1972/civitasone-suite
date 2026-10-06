import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./DelayAnalysisTable", () => ({
  DelayAnalysisTable: ({ rows }: { rows: unknown[] }) => <div>delay-table:{rows.length}</div>,
}));

import DelayAnalysisPage from "./page";

function mockRows(rows: unknown[], source: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/delay-analysis")) {
      return Promise.resolve({ data: source === "error" ? [] : rows, source });
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

function tileValue(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.textContent;
}

describe("DelayAnalysisPage tile buckets (GAP-PROJECTS-DELAY-ANALYSIS-01)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("buckets the delay-analysis vocabulary (active/review/overdue) into On Track/At Risk/Delayed", async () => {
    mockRows([
      { project: "A", originalDeadline: "2026-01-01", revisedDeadline: "2026-02-01", delayDays: 0, cause: "-", rag: "active" },
      { project: "B", originalDeadline: "2026-01-01", revisedDeadline: "2026-03-01", delayDays: 30, cause: "rain", rag: "review" },
      { project: "C", originalDeadline: "2026-01-01", revisedDeadline: "2026-04-01", delayDays: 60, cause: "land", rag: "overdue" },
    ]);
    render(await DelayAnalysisPage());
    expect(tileValue("On Track")).toContain("1");
    expect(tileValue("At Risk")).toContain("1");
    expect(tileValue("Delayed")).toContain("1");
    expect(tileValue("Total Projects")).toContain("3");
    // No unmapped values -> no Other tile.
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("also buckets the canonical green/amber/red vocabulary identically", async () => {
    mockRows([
      { project: "A", originalDeadline: "x", revisedDeadline: "y", delayDays: 0, cause: "-", rag: "green" },
      { project: "B", originalDeadline: "x", revisedDeadline: "y", delayDays: 5, cause: "-", rag: "amber" },
      { project: "C", originalDeadline: "x", revisedDeadline: "y", delayDays: 9, cause: "-", rag: "red" },
    ]);
    render(await DelayAnalysisPage());
    expect(tileValue("On Track")).toContain("1");
    expect(tileValue("At Risk")).toContain("1");
    expect(tileValue("Delayed")).toContain("1");
  });

  it("surfaces an Other bucket for an unmapped RAG value so tiles reconcile to Total", async () => {
    mockRows([
      { project: "A", originalDeadline: "x", revisedDeadline: "y", delayDays: 0, cause: "-", rag: "green" },
      { project: "Z", originalDeadline: "x", revisedDeadline: "y", delayDays: 0, cause: "-", rag: "mystery" },
    ]);
    render(await DelayAnalysisPage());
    expect(tileValue("On Track")).toContain("1");
    expect(tileValue("Other")).toContain("1");
    expect(tileValue("Total Projects")).toContain("2");
  });
});
