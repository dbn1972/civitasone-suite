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

const ROW_2: AssessmentRow = {
  ...ROW,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  assesseeId: "33333333-3333-3333-3333-333333333333",
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

  it("has distinct accessible names for repeated row action buttons across assessees sharing a financial year", () => {
    render(<AssessmentsTable assessments={[ROW, ROW_2]} />);
    expect(screen.getByLabelText("Approve remission for assessment aaaaaaaa, FY 2026-27")).toBeInTheDocument();
    expect(screen.getByLabelText("Reject remission for assessment aaaaaaaa, FY 2026-27")).toBeInTheDocument();
    expect(screen.getByLabelText("Approve remission for assessment bbbbbbbb, FY 2026-27")).toBeInTheDocument();
    expect(screen.getByLabelText("Reject remission for assessment bbbbbbbb, FY 2026-27")).toBeInTheDocument();
  });

  it("gives the Revise field panel an accessible name and focuses the input on open", async () => {
    render(<AssessmentsTable assessments={[ROW]} />);
    fireEvent.click(screen.getByLabelText("Revise assessment aaaaaaaa for FY 2026-27"));

    const dialog = await screen.findByRole("dialog", { name: "Revise this assessment — enter new base value" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText(/New Base Value/)).toHaveFocus();
  });

  it("focuses the invalid field when Revise validation fails", async () => {
    render(<AssessmentsTable assessments={[ROW]} />);
    fireEvent.click(screen.getByLabelText("Revise assessment aaaaaaaa for FY 2026-27"));
    await screen.findByRole("dialog", { name: "Revise this assessment — enter new base value" });

    fireEvent.click(screen.getByText("Continue"));

    // GAP-REVENUE-ASSESSMENTS-05 deliberately changed continueRevise to validate the
    // rupees input with rupeesToMinorString (bigint paise, no float), replacing the old
    // parseFloat check; the message is now the rupees-with-2-decimals guidance.
    expect(
      await screen.findByText("Enter an amount in rupees with up to 2 decimals, e.g. 850000 or 8500.50."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/New Base Value/)).toHaveFocus();
  });

  it("approves a remission on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<AssessmentsTable assessments={[ROW]} />);
    fireEvent.click(screen.getByLabelText("Approve remission for assessment aaaaaaaa, FY 2026-27"));
    await waitFor(() => expect(screen.getByText("Approve this remission?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve remission"));

    await waitFor(() => {
      expect(screen.getByText("Remission for FY 2026-27 approved.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe message on a same-user decision, never the raw server code/message (UX-016)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "MAKER_CHECKER_VIOLATION", message: "decider must differ from maker" } }), {
        status: 409,
      }),
    );

    render(<AssessmentsTable assessments={[ROW]} />);
    fireEvent.click(screen.getByLabelText("Reject remission for assessment aaaaaaaa, FY 2026-27"));
    await waitFor(() => expect(screen.getByText("Reject this remission?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Reject remission"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/MAKER_CHECKER_VIOLATION/)).not.toBeInTheDocument();
  });

  // ── GAP-REVENUE-ASSESSMENTS-01: remission gating ────────────────────────────
  it("disables Approve/Reject on a row with no pending remission", () => {
    render(<AssessmentsTable assessments={[{ ...ROW, remissionStatus: "none" }]} currentUserId="checker-1" />);
    expect(screen.getByLabelText("Approve remission for assessment aaaaaaaa, FY 2026-27")).toBeDisabled();
    expect(screen.getByLabelText("Reject remission for assessment aaaaaaaa, FY 2026-27")).toBeDisabled();
  });

  it("disables Approve/Reject when the current officer requested the pending remission (maker-checker)", () => {
    render(
      <AssessmentsTable
        assessments={[{ ...ROW, remissionStatus: "pending", remissionRequestedBy: "checker-1" }]}
        currentUserId="checker-1"
      />,
    );
    expect(screen.getByLabelText("Approve remission for assessment aaaaaaaa, FY 2026-27")).toBeDisabled();
    expect(screen.getByLabelText("Reject remission for assessment aaaaaaaa, FY 2026-27")).toBeDisabled();
  });

  it("enables Approve/Reject on a pending remission requested by a DIFFERENT officer", () => {
    render(
      <AssessmentsTable
        assessments={[{ ...ROW, remissionStatus: "pending", remissionRequestedBy: "maker-9" }]}
        currentUserId="checker-1"
      />,
    );
    expect(screen.getByLabelText("Approve remission for assessment aaaaaaaa, FY 2026-27")).toBeEnabled();
    expect(screen.getByLabelText("Reject remission for assessment aaaaaaaa, FY 2026-27")).toBeEnabled();
  });

  it("disables Remit while a remission is already pending (no duplicate request)", () => {
    render(
      <AssessmentsTable
        assessments={[{ ...ROW, remissionStatus: "pending", remissionRequestedBy: "maker-9" }]}
        currentUserId="checker-1"
      />,
    );
    expect(screen.getByLabelText("Request remission for assessment aaaaaaaa, FY 2026-27")).toBeDisabled();
  });

  it("shows the assessee's name (not a raw UUID) when the page provides it (ASSESSMENTS-02)", () => {
    render(<AssessmentsTable assessments={[{ ...ROW, assesseeName: "Ravi Kumar — PMC-0001" }]} currentUserId="checker-1" />);
    expect(screen.getByText("Ravi Kumar — PMC-0001")).toBeInTheDocument();
  });
});
