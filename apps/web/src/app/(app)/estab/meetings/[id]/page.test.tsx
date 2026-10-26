import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../../../meeting/_data/client", () => ({
  fetchMinutes: vi.fn().mockResolvedValue(null),
  createMinutes: vi.fn(),
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
    const ui = await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) });
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
    const ui = await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) });
    const { container } = render(ui);

    const steps = Array.from(container.querySelectorAll("li"));
    const actionsClosed = steps.find((li) => li.textContent?.includes("Actions closed"));
    expect(actionsClosed?.className).toBe("done");
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-03: scheduled date is formatted, not raw", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) });
    render(ui);

    // Raw date "2026-10-01" should not appear; formatted date should.
    expect(screen.queryByText("2026-10-01")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-04: MOM shows 'Not yet held' for scheduled meeting", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("Not yet held")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-04: MOM shows 'Pending' for in_progress meeting without minutes", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting({ status: "in_progress" }), source: "api" });
    const ui = await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(1);
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-06: absent attendee shows grey 'Absent' pill, not red 'No'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    const ui = await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) });
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

  it("GAP-ESTAB-MEETINGS-DETAIL-02: the timeline has no empty date slot, and a cancelled meeting does not show the agenda as circulated", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting({ status: "cancelled" }), source: "api" });
    const { container } = render(await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) }));
    const slots = Array.from(container.querySelectorAll(".tl .d"));
    expect(slots.map((d) => d.textContent)).toEqual(["01 Oct 2026"]);
    const agenda = Array.from(container.querySelectorAll("li")).find((li) => li.textContent?.includes("Agenda circulated"));
    expect(agenda?.className).toBe("todo");
    expect(screen.getByText(/Stages are inferred from the meeting's status/)).toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-04: a completed meeting with minutes shows them", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting({ status: "completed", minutes: "Budget approved." }), source: "api" });
    render(await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(screen.getByText("Budget approved.")).toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-05: the header is the shared PageHeader (back link, h1 with the title and status) and the only Agenda route is the tab", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    render(await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) }));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.id).toBe("page-heading");
    expect(h1.textContent).toContain("Budget Review");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/estab/meetings");
    expect(screen.getAllByRole("tab", { name: /^Agenda/ })).toHaveLength(1);
    // Owner decision #30: the dead disabled Generate MOM button is replaced by a link to the MOM section.
    expect(screen.queryByRole("button", { name: "Generate MOM" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Minutes (MOM)" })).toHaveAttribute("href", "#mom");
  });

  it("owner decision #30: an unlinked meeting offers to link a meeting from the Meetings module", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting(), source: "api" });
    render(await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Link a meeting" })).toBeInTheDocument();
  });

  it("owner decision #30: a linked meeting shows the link and routes into the minutes workflow", async () => {
    const gov = "11111111-1111-4111-8111-111111111111";
    fetchJsonMock.mockResolvedValueOnce({ data: makeMeeting({ governanceMeetingId: gov, status: "completed" }), source: "api" });
    render(await MeetingDetailPage({ params: Promise.resolve({ id: "m1" }), searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Linked to the Meetings module")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open minutes workflow" })).toHaveAttribute("href", `/meeting/meetings/${gov}/minutes`);
  });
});
