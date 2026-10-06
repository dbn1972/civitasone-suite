import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn(() => ["employee"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

const getAssessmentsMock = vi.fn();
vi.mock("../_data", () => ({
  getAssessments: () => getAssessmentsMock(),
}));

import AssessmentsPage from "./page";

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getAssessmentsMock.mockResolvedValue({ data: [], source: "api" });
});

async function renderPage() {
  render(await AssessmentsPage());
}

describe("AssessmentsPage — GAP-LEARNING-ASSESSMENTS-02/03/04", () => {
  it("ASSESSMENTS-02 (defence in depth): a learner never sees draft/pending/retired rows", async () => {
    getAssessmentsMock.mockResolvedValue({
      data: [
        { id: "a1", title: "Draft one", passingScore: "40", durationMins: 30, maxAttempts: 2, status: "draft" },
        { id: "a2", title: "Published one", passingScore: "50", durationMins: 30, maxAttempts: 2, status: "published" },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Published one")).toBeInTheDocument();
    expect(screen.queryByText("Draft one")).not.toBeInTheDocument();
  });

  it("ASSESSMENTS-02: HR sees every status", async () => {
    rolesMock.mockReturnValue(["hr_admin"]);
    getAssessmentsMock.mockResolvedValue({
      data: [
        { id: "a1", title: "Draft one", passingScore: "40", durationMins: 30, maxAttempts: 2, status: "draft" },
        { id: "a2", title: "Published one", passingScore: "50", durationMins: 30, maxAttempts: 2, status: "published" },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Draft one")).toBeInTheDocument();
    expect(screen.getByText("Published one")).toBeInTheDocument();
  });

  it("ASSESSMENTS-04: passing score is shown with a 'marks' unit, not a bare number", async () => {
    getAssessmentsMock.mockResolvedValue({
      data: [{ id: "a2", title: "Pub", passingScore: "50", durationMins: 30, maxAttempts: 2, status: "published" }],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("50 marks")).toBeInTheDocument();
  });
});
