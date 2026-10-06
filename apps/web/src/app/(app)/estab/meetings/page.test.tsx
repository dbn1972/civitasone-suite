import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import MeetingsPage from "./page";

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    meetingNo: "MTG-001",
    title: "Budget Review",
    scheduledDate: "2026-12-01",
    scheduledTime: "10:00",
    venue: "Room 101",
    attendeesCount: 5,
    agendaItemsCount: 3,
    status: "scheduled",
    ...overrides,
  };
}

describe("MeetingsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("GAP-ESTAB-MEETINGS-01: all stats show '—' on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });
    const ui = await MeetingsPage({ searchParams: {} });
    const { container } = render(ui);

    const vals = Array.from(container.querySelectorAll(".val"));
    // Every stat should show '—'.
    expect(vals.every((v) => v.textContent === "—")).toBe(true);
    expect(vals.length).toBe(4);
  });

  it("GAP-ESTAB-MEETINGS-02: empty state does not say 'Schedule a meeting to get started'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await MeetingsPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText("Schedule a meeting to get started.")).not.toBeInTheDocument();
    expect(screen.getByText(/created from within a committee/)).toBeInTheDocument();
  });

  it("GAP-ESTAB-MEETINGS-02: '+ Schedule' links to /meeting/meetings/new", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await MeetingsPage({ searchParams: {} });
    render(ui);

    const scheduleLink = screen.getByRole("link", { name: "+ Schedule" });
    expect(scheduleLink).toBeInTheDocument();
    expect(scheduleLink.getAttribute("href")).toBe("/meeting/meetings/new");
  });

  it("GAP-ESTAB-MEETINGS-03: stat label reads 'In Progress', not 'MOM Pending'; 'Meetings Held' not 'Compliance'", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [makeMeeting({ status: "in_progress" }), makeMeeting({ id: "m2", status: "completed" })],
      source: "api",
    });
    const ui = await MeetingsPage({ searchParams: {} });
    const { container } = render(ui);

    const labs = Array.from(container.querySelectorAll(".lab")).map((l) => l.textContent);
    expect(labs).toContain("In Progress");
    expect(labs).not.toContain("MOM Pending");
    expect(labs).toContain("Meetings Held");
    expect(labs).not.toContain("Compliance");
  });
});
