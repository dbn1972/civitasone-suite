import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { EnrolmentsTable, type EnrolmentRow } from "./EnrolmentsTable";

const rows: EnrolmentRow[] = [
  { id: "1", course: "React Basics", code: "R1", progressPct: 65, statusRaw: "in_progress", courseId: "c1", resumeLessonId: "l9", overdue: false },
  { id: "2", course: "Done Course", code: "D1", progressPct: 100, statusRaw: "completed", courseId: "c2", resumeLessonId: "", overdue: false },
  { id: "3", course: "Stale Course", code: "S1", progressPct: 10, statusRaw: "in_progress", courseId: "c3", resumeLessonId: "l1", overdue: true },
];

describe("EnrolmentsTable (GAP-LEARNING-MY-LEARNING-03/04)", () => {
  it("renders a progress bar with an accessible value for the 65% row", () => {
    render(<EnrolmentsTable rows={rows} />);
    const bar = screen.getByRole("progressbar", { name: /React Basics progress 65%/ });
    expect(bar.getAttribute("aria-valuenow")).toBe("65");
    // numeric text alongside the bar
    expect(screen.getByText("65%")).toBeInTheDocument();
  });

  it("shows a Continue link for an in-progress course with a resume lesson", () => {
    render(<EnrolmentsTable rows={rows} />);
    const link = screen.getAllByRole("link", { name: /continue/i })[0];
    expect(link.getAttribute("href")).toBe("/learning/courses/c1/lessons/l9");
  });

  it("shows no Continue link for a completed course", () => {
    render(<EnrolmentsTable rows={[rows[1]!]} />);
    expect(screen.queryByRole("link", { name: /continue/i })).toBeNull();
  });

  it("shows an overdue pill for a stale enrolment", () => {
    render(<EnrolmentsTable rows={[rows[2]!]} />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });
});
