import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import MeetingDetailPage from "./page";

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    meetingNo: "MTG-001",
    title: "Budget Review",
    scheduledDate: "2026-10-01",
    scheduledTime: "10:00",
    venue: "Room 101",
    chairperson: "Director",
    attendeesCount: 3,
    agenda: [],
    actionPoints: [],
    attendees: [
      { name: "Priya", designation: "AO", present: true },
      { name: "Ravi", designation: "SO", present: false },
    ],
    minutes: null,
    status: "scheduled",
    ...overrides,
  };
}

describe("MeetingDetailPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("GAP-ESTAB-MEETINGS-DETAIL-01: Actions closed is todo for a scheduled meeting with no action points", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: { id: "m1" }, searchParams: {} });
    const { container } = render(ui);

    const steps = Array.from(container.querySelectorAll("li"));
    const actionsClosed = steps.find((li) => li.textContent?.includes("Actions closed"));
    expect(actionsClosed?.className).toBe("todo");
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-01: Actions closed is done for completed meeting with all actions completed", async () => {
    const meeting = makeMeeting({
      status: "completed",
      actionPoints: [{ id: "ap1", description: "Fix X", assignedTo: "Priya", dueDate: "2026-10-10", status: "completed" }],
      minutes: "All items discussed.",
    });
    fetchJsonMock.mockResolvedValueOnce({ data: meeting, source: "api" });
    const ui = await MeetingDetailPage({ params: { id: "m1" }, searchParams: {} });
    const { container } = render(ui);

    const steps = Array.from(container.querySelectorAll("li"));
    const actionsClosed = steps.find((li) => li.textContent?.includes("Actions closed"));
    expect(actionsClosed?.className).toBe("done");
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-03: scheduled date is formatted, not raw", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: { id: "m1" }, searchParams: {} });
    render(ui);

    // Raw date "2026-10-01" should not appear; formatted date should.
    expect(screen.queryByText("2026-10-01")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-04: MOM shows 'Not yet held' for scheduled meeting", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: { id: "m1" }, searchParams: {} });
    render(ui);

    expect(screen.getByText("Not yet held")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-04: MOM shows 'Pending' for in_progress meeting without minutes", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting({ status: "in_progress" }), source: "api" });
    const ui = await MeetingDetailPage({ params: { id: "m1" }, searchParams: {} });
    render(ui);

    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(1);
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-06: absent attendee shows grey 'Absent' pill, not red 'No'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: { id: "m1" }, searchParams: {} });
    const { container } = render(ui);

    // Ravi is absent — pill should say "Absent", not "No"
    expect(screen.getByText("Absent")).toBeInTheDocument();
    expect(screen.queryByText("No")).not.toBeInTheDocument();
    // Present attendee shows "Present", not "Yes"
    expect(screen.getAllByText("Present").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Yes")).not.toBeInTheDocument();
    // The "Absent" pill has a muted tone class (mut), not bad.
    const absentPill = container.querySelector(".pill.mut");
    expect(absentPill).not.toBeNull();
    expect(absentPill?.textContent).toBe("Absent");
  });
});
