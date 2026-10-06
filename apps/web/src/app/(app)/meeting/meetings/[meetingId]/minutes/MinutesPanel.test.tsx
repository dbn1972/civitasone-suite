import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const updateMinutesMock = vi.fn();
const submitMinutesMock = vi.fn();
const approveMinutesMock = vi.fn();
const rejectMinutesMock = vi.fn();
const createMinutesMock = vi.fn();
const fetchMinutesMock = vi.fn();

vi.mock("../../../_data/client", () => ({
  updateMinutes: (...a: unknown[]) => updateMinutesMock(...a),
  submitMinutes: (...a: unknown[]) => submitMinutesMock(...a),
  approveMinutes: (...a: unknown[]) => approveMinutesMock(...a),
  rejectMinutes: (...a: unknown[]) => rejectMinutesMock(...a),
  createMinutes: (...a: unknown[]) => createMinutesMock(...a),
  fetchMinutes: (...a: unknown[]) => fetchMinutesMock(...a),
}));

import { MinutesPanel } from "./MinutesPanel";
import type { Minutes } from "../../../_data/types";

function minutes(overrides: Partial<Minutes> = {}): Minutes {
  return {
    id: "min1",
    meetingId: "m1",
    templateType: "summary",
    content: "Saved content.",
    status: "draft",
    currentVersion: 1,
    approvedBy: null,
    approvedAt: null,
    dscSignerName: null,
    dscSignedAt: null,
    hashCurrent: null,
    createdBy: "user-maker",
    createdAt: null,
    updatedAt: null,
    version: 1,
    createdByName: null,
    approvedByName: null,
    rejectionComments: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectedByName: null,
    ...overrides,
  };
}

describe("MinutesPanel — Submit saves unsaved edits first (GAP-...-MINUTES-01)", () => {
  beforeEach(() => {
    updateMinutesMock.mockReset().mockResolvedValue(undefined);
    submitMinutesMock.mockReset().mockResolvedValue(undefined);
    fetchMinutesMock.mockReset().mockResolvedValue(minutes({ version: 2 }));
  });

  it("saves the edited textarea before submitting, using the fresh version", async () => {
    render(<MinutesPanel meetingId="m1" initialMinutes={minutes()} />);
    const textarea = screen.getByLabelText("Minutes content");
    fireEvent.change(textarea, { target: { value: "Edited content not yet saved." } });
    // Unsaved-edits note appears.
    expect(screen.getByText(/unsaved edits/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save & submit" }));
    await waitFor(() =>
      expect(updateMinutesMock).toHaveBeenCalledWith("m1", "min1", {
        version: 1,
        content: "Edited content not yet saved.",
      }),
    );
    // Submit uses the fresh (v2) version returned by the refresh poll.
    await waitFor(() => expect(submitMinutesMock).toHaveBeenCalledWith("m1", "min1", 2));
    // Save happened before submit.
    expect(updateMinutesMock.mock.invocationCallOrder[0]).toBeLessThan(
      submitMinutesMock.mock.invocationCallOrder[0],
    );
  });
});

describe("MinutesPanel — names + maker-checker (GAP-...-MINUTES-02)", () => {
  it("shows resolved names, not raw UUIDs, for drafter and approver", () => {
    render(
      <MinutesPanel
        meetingId="m1"
        initialMinutes={minutes({
          status: "approved",
          createdBy: "u-maker",
          createdByName: "Asha Rao",
          approvedBy: "u-checker",
          approvedByName: "Bimal Sen",
        })}
      />,
    );
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Bimal Sen")).toBeInTheDocument();
  });

  it("hides approve/reject from the drafter and explains maker-checker (self-approval)", () => {
    render(
      <MinutesPanel
        meetingId="m1"
        initialMinutes={minutes({ status: "submitted", createdBy: "u-maker" })}
        currentUserId="u-maker"
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve minutes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Return to secretary" })).not.toBeInTheDocument();
    expect(screen.getByText(/You drafted these minutes/)).toBeInTheDocument();
  });

  it("shows approve/reject to a non-drafter viewer", () => {
    render(
      <MinutesPanel
        meetingId="m1"
        initialMinutes={minutes({ status: "submitted", createdBy: "u-maker" })}
        currentUserId="u-checker"
      />,
    );
    expect(screen.getByRole("button", { name: "Approve minutes" })).toBeInTheDocument();
  });
});

describe("MinutesPanel — rejection reason banner (GAP-...-MINUTES-04)", () => {
  it("shows the return reason on a redrafted (draft) record", () => {
    render(
      <MinutesPanel
        meetingId="m1"
        initialMinutes={minutes({
          status: "draft",
          rejectionComments: "Please correct the quorum count.",
          rejectedByName: "Bimal Sen",
        })}
      />,
    );
    expect(screen.getByText(/Please correct the quorum count/)).toBeInTheDocument();
    expect(screen.getByText(/Returned by Bimal Sen/)).toBeInTheDocument();
  });

  it("shows no banner when there is no rejection reason", () => {
    render(<MinutesPanel meetingId="m1" initialMinutes={minutes({ status: "draft" })} />);
    expect(screen.queryByText(/Returned by/)).not.toBeInTheDocument();
  });
});

describe("MinutesPanel — outage vs not-drafted (GAP-...-MINUTES-05)", () => {
  it("offers Create for a genuine 404 (notDrafted)", () => {
    render(<MinutesPanel meetingId="m1" initialMinutes={null} notDrafted />);
    expect(screen.getByRole("button", { name: /Create minutes draft/ })).toBeInTheDocument();
  });

  it("does NOT offer Create during an outage", () => {
    render(<MinutesPanel meetingId="m1" initialMinutes={null} notDrafted={false} />);
    expect(screen.queryByRole("button", { name: /Create minutes draft/ })).not.toBeInTheDocument();
    expect(screen.getByText("Minutes couldn't be loaded")).toBeInTheDocument();
  });
});
