import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAssessmentMock = vi.fn();
const getAssessmentQuestionsMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../../_data", () => ({
  getAssessment: (...a: unknown[]) => getAssessmentMock(...a),
  getAssessmentQuestions: (...a: unknown[]) => getAssessmentQuestionsMock(...a),
  getMyProfile: () => getMyProfileMock(),
}));
// AttemptClient is a client component; stub it so this test focuses on the
// server page's gating/states.
vi.mock("./AttemptClient", () => ({
  AttemptClient: () => <div data-testid="attempt-client">attempt UI</div>,
}));

import AttemptPage from "./page";

beforeEach(() => {
  getMyProfileMock.mockResolvedValue({ data: { id: "emp-1", name: "A" }, source: "api" });
  getAssessmentMock.mockResolvedValue({ data: { id: "a1", title: "Exam", passingScore: "50", durationMins: 30, maxAttempts: 2, status: "published" }, source: "api" });
  getAssessmentQuestionsMock.mockResolvedValue({ data: [{ id: "q1", qtype: "single", stem: "?", options: [{ id: "o1", text: "x" }] }], source: "api" });
});

async function renderPage(id = "a1") {
  render(await AttemptPage({ params: { id } }));
}

describe("Assessment attempt page — GAP-LEARNING-ASSESSMENTS-01", () => {
  it("renders the attempt UI for a published assessment with questions and a linked employee", async () => {
    await renderPage();
    expect(screen.getByTestId("attempt-client")).toBeInTheDocument();
  });

  it("blocks attempts on a non-published assessment", async () => {
    getAssessmentMock.mockResolvedValue({ data: { id: "a1", title: "Exam", passingScore: "50", durationMins: 30, maxAttempts: 2, status: "draft" }, source: "api" });
    await renderPage();
    expect(screen.getByText("Not open for attempts")).toBeInTheDocument();
    expect(screen.queryByTestId("attempt-client")).not.toBeInTheDocument();
  });

  it("shows an honest message when the account has no linked employee record", async () => {
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    await renderPage();
    expect(screen.getByText("No employee profile linked")).toBeInTheDocument();
  });

  it("shows not-found for a missing assessment", async () => {
    getAssessmentMock.mockResolvedValue({ data: null, source: "api" });
    await renderPage();
    expect(screen.getByText("Assessment not found")).toBeInTheDocument();
  });
});
