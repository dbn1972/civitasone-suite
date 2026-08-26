import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import OnboardingDetailPage from "./page";

const SUMMARY_ROW = {
  id: "emp-1",
  employee: "Priya Nair",
  department: "Finance",
  joiningDate: "2026-08-01",
  stepsCompleted: "1/3",
  totalSteps: "3",
  progress: "33%",
  status: "in_progress",
};

const REAL_TASKS = [
  { id: "task-1", title: "Submit joining report", dueByDay: 1, status: "completed" },
  { id: "task-2", title: "Collect department ID badge", dueByDay: 3, status: "pending" },
  { id: "task-3", title: "Complete cyber-security briefing", dueByDay: 7, status: "pending" },
];

function mockFor(path: string) {
  return path.includes("/onboarding-tasks")
    ? { data: REAL_TASKS, source: "api" }
    : { data: [SUMMARY_ROW], source: "api" };
}

describe("OnboardingDetailPage", () => {
  it("renders the employee's real onboarding tasks, not invented placeholder progress", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

    // Real task titles appear once in the checklist panel and once in the task
    // calendar panel — both are legitimate, so assert presence, not uniqueness.
    expect(screen.getAllByText("Submit joining report").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Collect department ID badge").length).toBeGreaterThan(0);

    // These exact strings were the hardcoded fallback shown for every joinee,
    // regardless of their real state — must never appear again.
    expect(screen.queryByText("Documents Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("ID Card Issued")).not.toBeInTheDocument();
    expect(screen.queryByText("Probation Review Scheduled")).not.toBeInTheDocument();
  });

  it("does not fabricate a specific reporting manager or office location the API never sent", async () => {
    fetchJsonMock.mockImplementation((path: string) => Promise.resolve(mockFor(path)));
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

    expect(screen.queryByText("Department Head")).not.toBeInTheDocument();
    expect(screen.queryByText(/Head Office, New Delhi/)).not.toBeInTheDocument();
  });

  it("shows a genuine empty state instead of a fabricated 6-step checklist when no tasks exist yet", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/onboarding-tasks") ? { data: [], source: "api" } : { data: [SUMMARY_ROW], source: "api" }),
    );
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));

    expect(screen.getByText(/no onboarding tasks set up yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Documents Submitted")).not.toBeInTheDocument();
  });

  it("flags the data source as error if either the summary or the tasks fetch fails", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("/onboarding-tasks")
          ? { data: [], source: "error" }
          : { data: [SUMMARY_ROW], source: "api" },
      ),
    );
    render(await OnboardingDetailPage({ params: Promise.resolve({ id: "emp-1" }) }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
