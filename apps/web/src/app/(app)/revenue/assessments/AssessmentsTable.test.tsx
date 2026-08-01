import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AssessmentsTable, type AssessmentRow } from "./AssessmentsTable";

const ROW: AssessmentRow = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  assesseeId: "11111111-1111-1111-1111-111111111111",
  rateHeadId: "22222222-2222-2222-2222-222222222222",
  financialYear: "2026-27",
  baseValue: "85000000",
  status: "active",
  version: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("AssessmentsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders rows and an empty state", () => {
    const { rerender } = render(<AssessmentsTable assessments={[ROW]} />);
    expect(screen.getByText("2026-27")).toBeInTheDocument();

    rerender(<AssessmentsTable assessments={[]} />);
    expect(screen.getByText("No assessments yet")).toBeInTheDocument();
  });

  it("has distinct accessible names for repeated row action buttons", () => {
    render(<AssessmentsTable assessments={[ROW]} />);
    expect(screen.getByLabelText("Approve remission for FY 2026-27 assessment")).toBeInTheDocument();
    expect(screen.getByLabelText("Reject remission for FY 2026-27 assessment")).toBeInTheDocument();
  });

  it("approves a remission on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<AssessmentsTable assessments={[ROW]} />);
    fireEvent.click(screen.getByLabelText("Approve remission for FY 2026-27 assessment"));
    await waitFor(() => expect(screen.getByText("Approve this remission?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve remission"));

    await waitFor(() => {
      expect(screen.getByText("Remission for FY 2026-27 approved.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces the server maker-checker error on a same-user decision (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "MAKER_CHECKER_VIOLATION", message: "decider must differ from maker" } }), {
        status: 409,
      }),
    );

    render(<AssessmentsTable assessments={[ROW]} />);
    fireEvent.click(screen.getByLabelText("Reject remission for FY 2026-27 assessment"));
    await waitFor(() => expect(screen.getByText("Reject this remission?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Reject remission"));

    await waitFor(() => {
      expect(screen.getByText(/MAKER_CHECKER_VIOLATION: decider must differ from maker/)).toBeInTheDocument();
    });
  });
});
