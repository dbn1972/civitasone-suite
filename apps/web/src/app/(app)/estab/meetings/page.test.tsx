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

  it("GAP-ESTAB-MEETINGS-05: the active view carries aria-current=page, the other does not", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const { unmount } = render(await MeetingsPage({ searchParams: {} }));
    expect(screen.getByRole("link", { name: "List" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Calendar" })).not.toHaveAttribute("aria-current");
    unmount();
    render(await MeetingsPage({ searchParams: { view: "calendar" } }));
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "List" })).not.toHaveAttribute("aria-current");
  });

  it("GAP-ESTAB-MEETINGS-04: at 01:00 IST a meeting dated today counts as upcoming (the date is the IST day, not UTC)", async () => {
    vi.useFakeTimers();
    try {
      // 2026-10-14T19:30:00Z is 2026-10-15 01:00 IST: UTC "today" is still the 14th.
      vi.setSystemTime(new Date("2026-10-14T19:30:00.000Z"));
      fetchJsonMock.mockResolvedValueOnce({
        data: [
          makeMeeting({ id: "today", scheduledDate: "2026-10-15", status: "scheduled" }),
          makeMeeting({ id: "yesterday", scheduledDate: "2026-10-14", status: "scheduled" }),
        ],
        source: "api",
      });
      const { container } = render(await MeetingsPage({ searchParams: {} }));
      const upcoming = Array.from(container.querySelectorAll(".stat")).find((c) => c.textContent?.includes("Upcoming Meetings"));
      expect(upcoming?.textContent).toContain("1");
      expect(upcoming?.textContent).not.toContain("2");
    } finally {
      vi.useRealTimers();
    }
  });
});
