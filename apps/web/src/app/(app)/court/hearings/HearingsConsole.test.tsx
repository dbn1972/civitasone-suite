import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const scheduleHearingMock = vi.fn();
const adjournHearingMock = vi.fn();
const recordHearingOutcomeMock = vi.fn();
const fetchCaseHearingsMock = vi.fn();

vi.mock("../_data/client", () => ({
  scheduleHearing: (...args: unknown[]) => scheduleHearingMock(...args),
  adjournHearing: (...args: unknown[]) => adjournHearingMock(...args),
  recordHearingOutcome: (...args: unknown[]) => recordHearingOutcomeMock(...args),
  fetchCaseHearings: (...args: unknown[]) => fetchCaseHearingsMock(...args),
}));

import { HearingsConsole } from "./HearingsConsole";
import type { Hearing } from "../_data/types";

const caseSummary = { title: "State vs. Sharma", cnrNumber: "DLHC010000012026" };

const scheduledHearing: Hearing = {
  id: "hearing-1",
  caseId: "case-1",
  benchId: null,
  scheduledDate: "2099-01-15T10:00:00.000Z",
  status: "scheduled",
  nextDate: null,
  purpose: "arguments",
  adjournmentReason: null,
  version: 1,
};

describe("HearingsConsole", () => {
  beforeEach(() => {
    scheduleHearingMock.mockReset();
    adjournHearingMock.mockReset();
    recordHearingOutcomeMock.mockReset();
    fetchCaseHearingsMock.mockReset();
    fetchCaseHearingsMock.mockResolvedValue([scheduledHearing]);
  });

  it("renders the hearings list", () => {
    render(
      <HearingsConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialHearings={[scheduledHearing]}
        hearingsSource="api"
      />,
    );
    expect(screen.getByText("Hearings (1)")).toBeInTheDocument();
    expect(screen.getByText(/arguments/i)).toBeInTheDocument();
  });

  it("renders a genuine empty state (not the saved-information badge) when there are no hearings", () => {
    render(
      <HearingsConsole caseId="case-1" caseSummary={caseSummary} initialHearings={[]} hearingsSource="api" />,
    );
    expect(screen.getByText("No hearings yet")).toBeInTheDocument();
    expect(screen.queryByText("Showing saved information")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge (not an empty state) when the hearings source is 'error'", () => {
    render(
      <HearingsConsole caseId="case-1" caseSummary={caseSummary} initialHearings={[]} hearingsSource="error" />,
    );
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
    expect(screen.queryByText("No hearings yet")).not.toBeInTheDocument();
  });

  it("never renders a raw '(0)' count in the card title when the source is 'error' (even with stale rows)", () => {
    render(
      <HearingsConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialHearings={[scheduledHearing]}
        hearingsSource="error"
      />,
    );
    // Title drops the count entirely rather than asserting "(1)" as fact
    // while the badge says the data may be stale.
    expect(screen.getByText("Hearings")).toBeInTheDocument();
    expect(screen.queryByText(/Hearings \(/)).not.toBeInTheDocument();
  });

  it("flips the source to 'error' (surfacing the badge) when the post-mutation reload fails, without dropping the rows", async () => {
    scheduleHearingMock.mockResolvedValue(undefined);
    fetchCaseHearingsMock.mockRejectedValue(new Error("network error"));
    render(
      <HearingsConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialHearings={[scheduledHearing]}
        hearingsSource="api"
      />,
    );
    fireEvent.change(screen.getByLabelText(/Date & time/), { target: { value: "2099-06-01T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule hearing" }));
    await waitFor(() => expect(screen.getByText("Showing saved information")).toBeInTheDocument());
    // The stale row is still shown, just no longer asserted as fresh.
    expect(screen.getByText(/arguments/i)).toBeInTheDocument();
  });

  it("rejects a past hearing date via the custom validator without calling the server", () => {
    render(
      <HearingsConsole caseId="case-1" caseSummary={caseSummary} initialHearings={[]} hearingsSource="api" />,
    );
    fireEvent.change(screen.getByLabelText(/Date & time/), { target: { value: "2000-01-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule hearing" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/must be in the future/);
    expect(scheduleHearingMock).not.toHaveBeenCalled();
  });

  it("schedules a future hearing (happy path)", async () => {
    scheduleHearingMock.mockResolvedValue(undefined);
    render(
      <HearingsConsole caseId="case-1" caseSummary={caseSummary} initialHearings={[]} hearingsSource="api" />,
    );
    fireEvent.change(screen.getByLabelText(/Date & time/), { target: { value: "2099-06-01T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule hearing" }));
    await waitFor(() => expect(scheduleHearingMock).toHaveBeenCalledTimes(1));
    expect(scheduleHearingMock.mock.calls[0][0]).toBe("case-1");
    await waitFor(() => expect(screen.getByText(/Hearing scheduling submitted\./)).toBeInTheDocument());
  });

  it("surfaces the server's error message when recording an outcome fails, via ConfirmDialog", async () => {
    recordHearingOutcomeMock.mockRejectedValue(new Error("VERSION_CONFLICT: hearing was updated concurrently"));
    render(
      <HearingsConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialHearings={[scheduledHearing]}
        hearingsSource="api"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Record outcome for the hearing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm outcome" }));
    await waitFor(() =>
      expect(screen.getByText(/VERSION_CONFLICT: hearing was updated concurrently/)).toBeInTheDocument(),
    );
  });
});
