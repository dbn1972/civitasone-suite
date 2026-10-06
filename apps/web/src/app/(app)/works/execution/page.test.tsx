import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getExecutionProgress = vi.fn();
const getExecutionIssues = vi.fn();
vi.mock("../_data/loaders", () => ({
  getExecutionProgress: () => getExecutionProgress(),
  getExecutionIssues: () => getExecutionIssues(),
}));
// The client table has its own deps (offline cache, tabs); this test is about
// the server page's stat cards reacting to each fetch's source independently.
vi.mock("./ExecutionTable", () => ({ ExecutionTable: () => null }));

import ExecutionPage from "./page";

function row(pct: number) {
  return { id: `p-${pct}-${Math.random()}`, workId: "w1", percentage: pct };
}

describe("ExecutionPage stat cards", () => {
  beforeEach(() => {
    getExecutionProgress.mockReset();
    getExecutionIssues.mockReset();
  });

  it("GAP-WORKS-EXECUTION-03: buckets are mutually exclusive and sum to the total", async () => {
    // 0, 30, 50, 79, 80, 99, 100 → notStarted, atRisk, inProgress, inProgress, onTrack, onTrack, completed
    const pcts = [0, 30, 50, 79, 80, 99, 100];
    getExecutionProgress.mockResolvedValue({ data: pcts.map(row), source: "api" });
    getExecutionIssues.mockResolvedValue({ data: [], source: "api" });

    render(await ExecutionPage());

    // Progress Entries total = 7
    const entries = screen.getByText("Progress Entries").closest(".stat")!;
    expect(entries.querySelector(".val")!.textContent).toBe("7");
    // onTrack = {80,99} = 2
    const onTrack = screen.getByText("On Track").closest(".stat")!;
    expect(onTrack.querySelector(".val")!.textContent).toBe("2");
    // At Risk = {30} = 1 (0 is notStarted, not at-risk; 50/79 are inProgress)
    const atRisk = screen.getByText("At Risk").closest(".stat")!;
    expect(atRisk.querySelector(".val")!.textContent).toBe("1");
    // Completed = {100} = 1 (NOT also counted in On Track)
    const completed = screen.getByText("Completed").closest(".stat")!;
    expect(completed.querySelector(".val")!.textContent).toBe("1");
  });

  it("GAP-WORKS-EXECUTION-02: a progress-fetch error blanks progress cards with '—', leaving the issues card intact", async () => {
    getExecutionProgress.mockResolvedValue({ data: [], source: "error" });
    getExecutionIssues.mockResolvedValue({
      data: [{ id: "i1", workId: "w1", status: "open" }],
      source: "api",
    });

    render(await ExecutionPage());

    expect(screen.getByText("Progress Entries").closest(".stat")!.querySelector(".val")!.textContent).toBe("—");
    expect(screen.getByText("On Track").closest(".stat")!.querySelector(".val")!.textContent).toBe("—");
    // Issues card is unaffected by the progress failure.
    expect(screen.getByText("Open Issues").closest(".stat")!.querySelector(".val")!.textContent).toBe("1");
  });

  it("GAP-WORKS-EXECUTION-02: an issues-fetch error blanks only the Open Issues card", async () => {
    getExecutionProgress.mockResolvedValue({ data: [row(100)], source: "api" });
    getExecutionIssues.mockResolvedValue({ data: [], source: "error" });

    render(await ExecutionPage());

    expect(screen.getByText("Open Issues").closest(".stat")!.querySelector(".val")!.textContent).toBe("—");
    // Progress cards still show real numbers.
    expect(screen.getByText("Progress Entries").closest(".stat")!.querySelector(".val")!.textContent).toBe("1");
    expect(screen.getByText("Completed").closest(".stat")!.querySelector(".val")!.textContent).toBe("1");
  });
});
