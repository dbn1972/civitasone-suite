import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const createMeetingMock = vi.fn();
const listCommitteesMock = vi.fn();
vi.mock("../../_data/client", () => ({
  createMeeting: (...args: unknown[]) => createMeetingMock(...args),
  listCommittees: (...args: unknown[]) => listCommitteesMock(...args),
}));

import { NewMeetingForm } from "./NewMeetingForm";

const VALID_UUID_1 = "11111111-1111-1111-1111-111111111111";
const VALID_UUID_2 = "22222222-2222-2222-2222-222222222222";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Budget review" } });
  fireEvent.change(screen.getByLabelText(/Scheduled date/), {
    target: { value: "2027-01-15T10:00" },
  });
  fireEvent.change(screen.getByLabelText(/Chairperson user ID/), {
    target: { value: VALID_UUID_1 },
  });
  fireEvent.change(screen.getByLabelText(/Secretary user ID/), {
    target: { value: VALID_UUID_2 },
  });
}

describe("NewMeetingForm", () => {
  beforeEach(() => {
    pushMock.mockClear();
    createMeetingMock.mockReset();
    listCommitteesMock.mockReset().mockResolvedValue([]);
  });

  it("shows validation errors and does not submit when required fields are empty", async () => {
    render(<NewMeetingForm />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));

    expect(await screen.findByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByText("Pick a date and time.")).toBeInTheDocument();
    expect(screen.getByText("Enter the chairperson's user ID.")).toBeInTheDocument();
    expect(screen.getByText("Enter the secretary's user ID.")).toBeInTheDocument();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("rejects a chairperson id that isn't a UUID", async () => {
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Chairperson user ID/), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));

    expect(await screen.findByText("Enter a valid user ID (UUID format).")).toBeInTheDocument();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("rejects a duration of 0 or below", async () => {
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Duration/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));

    expect(
      await screen.findByText("Duration must be a whole number of minutes greater than 0."),
    ).toBeInTheDocument();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("rejects a duration over 1440 minutes", async () => {
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Duration/), { target: { value: "1441" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));

    expect(
      await screen.findByText("Duration can't exceed 1440 minutes (24 hours)."),
    ).toBeInTheDocument();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("submits a well-formed payload and navigates to the new meeting on success", async () => {
    createMeetingMock.mockResolvedValue({ id: "meeting-123" });
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));

    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(1));
    const payload = createMeetingMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "Budget review",
      type: "committee",
      durationMinutes: 60,
      chairpersonId: VALID_UUID_1,
      secretaryId: VALID_UUID_2,
    });
    // scheduledAt must be a full ISO instant with an offset (zod .datetime({offset:true})).
    expect(payload.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/meeting/meetings/meeting-123"), {
      timeout: 3000,
    });
  });

  it("shows the server error and does not navigate when the create call fails", async () => {
    createMeetingMock.mockRejectedValue(new Error("COMMITTEE_NOT_FOUND: committee not found"));
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));

    // The banner renders "⚠ {message}" as sibling text nodes, so match on
    // the message as a substring rather than the element's exact full text.
    expect(await screen.findByText(/COMMITTEE_NOT_FOUND: committee not found/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("populates the committee dropdown from listCommittees", async () => {
    listCommitteesMock.mockResolvedValue([
      { id: "c1", name: "Finance Committee", type: "standing", status: "active" },
    ]);
    render(<NewMeetingForm />);
    expect(await screen.findByRole("option", { name: "Finance Committee" })).toBeInTheDocument();
  });

  it("degrades gracefully when the committee list fails to load", async () => {
    listCommitteesMock.mockRejectedValue(new Error("network error"));
    render(<NewMeetingForm />);
    expect(
      await screen.findByText("Couldn't load the committee list — you can still schedule without one."),
    ).toBeInTheDocument();
  });
});

describe("NewMeetingForm — gap items", () => {
  beforeEach(() => {
    pushMock.mockClear();
    createMeetingMock.mockReset();
    listCommitteesMock.mockReset().mockResolvedValue([]);
  });

  it("GAP-MEETING-MEETINGS-NEW-01: rejects chairperson == secretary", async () => {
    render(<NewMeetingForm />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dup roles" } });
    fireEvent.change(screen.getByLabelText(/Scheduled date/), { target: { value: "2027-01-15T10:00" } });
    fireEvent.change(screen.getByLabelText(/Chairperson user ID/), { target: { value: VALID_UUID_1 } });
    fireEvent.change(screen.getByLabelText(/Secretary user ID/), { target: { value: VALID_UUID_1 } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));
    expect(
      await screen.findByText("The secretary must be a different person from the chairperson."),
    ).toBeInTheDocument();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("GAP-MEETING-MEETINGS-NEW-02: converts the datetime-local as IST (+05:30) regardless of TZ", async () => {
    createMeetingMock.mockResolvedValue({ id: "m-1" });
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));
    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(1));
    // 10:00 IST == 04:30 UTC.
    expect(createMeetingMock.mock.calls[0][0].scheduledAt).toBe("2027-01-15T04:30:00.000Z");
  });

  it("GAP-MEETING-MEETINGS-NEW-04: reuses one idempotency key across retries", async () => {
    createMeetingMock.mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce({ id: "m-2" });
    render(<NewMeetingForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));
    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Schedule meeting" }));
    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(2));
    const key1 = createMeetingMock.mock.calls[0][1]?.idempotencyKey;
    const key2 = createMeetingMock.mock.calls[1][1]?.idempotencyKey;
    expect(key1).toBeTruthy();
    expect(key1).toBe(key2);
  });

  it("GAP-MEETING-MEETINGS-NEW-05: Cancel on a dirty form opens a discard confirmation", () => {
    render(<NewMeetingForm />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("GAP-MEETING-MEETINGS-NEW-05: Cancel on a pristine form navigates immediately", () => {
    render(<NewMeetingForm />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pushMock).toHaveBeenCalledWith("/meeting/meetings");
  });

  it("GAP-MEETING-MEETINGS-NEW-03: shows a confidentiality explanation", () => {
    render(<NewMeetingForm />);
    fireEvent.change(screen.getByLabelText(/Confidentiality/), { target: { value: "secret" } });
    expect(screen.getByText(/Secret — restricted to named participants/)).toBeInTheDocument();
  });
});
