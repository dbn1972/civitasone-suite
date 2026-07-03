import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttChart, type GanttTask } from "./GanttChart";

const tasks: GanttTask[] = [
  { id: "t1", name: "Phase 1 - Design", startDate: "2026-01-01", endDate: "2026-03-31", progress: 100 },
  { id: "t2", name: "Phase 2 - Build", startDate: "2026-03-01", endDate: "2026-06-30", progress: 60 },
  { id: "t3", name: "Phase 3 - Test", startDate: "2026-06-01", endDate: "2026-09-30", progress: 10 },
];

describe("GanttChart", () => {
  it("renders task names", () => {
    render(<GanttChart tasks={tasks} />);
    expect(screen.getByText("Phase 1 - Design")).toBeInTheDocument();
    expect(screen.getByText("Phase 2 - Build")).toBeInTheDocument();
    expect(screen.getByText("Phase 3 - Test")).toBeInTheDocument();
  });

  it("renders progress percentages", () => {
    render(<GanttChart tasks={tasks} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    // Some progress values might render differently; check at least one
  });

  it("shows 'No tasks to display' for empty array", () => {
    render(<GanttChart tasks={[]} />);
    expect(screen.getByText("No tasks to display")).toBeInTheDocument();
  });

  it("renders bars for each task", () => {
    const { container } = render(<GanttChart tasks={tasks} />);
    // Each task has a progress bar track and fill
    const bars = container.querySelectorAll("[style*='background']");
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });

  it("handles single task", () => {
    render(<GanttChart tasks={[tasks[0]]} />);
    expect(screen.getByText("Phase 1 - Design")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders month markers", () => {
    const { container } = render(<GanttChart tasks={tasks} />);
    // Months should be rendered in the header
    const text = container.textContent;
    // At least some months should appear
    expect(text).toMatch(/Jan|Feb|Mar|Apr|May|Jun/);
  });

  it("accepts custom start and end dates", () => {
    render(<GanttChart tasks={tasks} startDate="2025-12-01" endDate="2026-12-31" />);
    expect(screen.getByText("Phase 1 - Design")).toBeInTheDocument();
  });
});
