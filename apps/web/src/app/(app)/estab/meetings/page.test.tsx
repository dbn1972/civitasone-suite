import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getMeetingsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getMeetings: (...args: unknown[]) => getMeetingsMock(...args),
}));

import MeetingsPage from "./page";

const MEETING = {
  id: "m1",
  meetingNo: "MTG-1",
  title: "Ward Committee",
  type: "committee",
  scheduledDate: "2027-03-15",
  scheduledTime: "10:00",
  attendeesCount: 5,
  agendaItemsCount: 2,
  status: "scheduled",
};

describe("estab/meetings/page.tsx (fix 3 + fix 8-style error/empty split)", () => {
  beforeEach(() => {
    getMeetingsMock.mockReset();
  });

  it("shows a real error state (not the generic 'No meetings found' empty copy) when the load fails", async () => {
    getMeetingsMock.mockResolvedValue({ data: [], source: "error" });
    render(await MeetingsPage({}));
    expect(screen.getByText("We couldn't load meetings.")).toBeInTheDocument();
    expect(screen.queryByText("No meetings found")).not.toBeInTheDocument();
  });

  it("shows the genuine empty state when the load succeeds with zero meetings", async () => {
    getMeetingsMock.mockResolvedValue({ data: [], source: "api" });
    render(await MeetingsPage({}));
    expect(screen.getByText("No meetings found")).toBeInTheDocument();
  });

  it("renders the table by default and the calendar when ?view=calendar is set", async () => {
    getMeetingsMock.mockResolvedValue({ data: [MEETING], source: "api" });

    const { unmount } = render(await MeetingsPage({}));
    expect(screen.getByText("Ward Committee")).toBeInTheDocument(); // table row
    unmount();

    render(await MeetingsPage({ searchParams: { view: "calendar" } }));
    expect(screen.getByText("March 2027")).toBeInTheDocument(); // calendar heading
  });

  it("disables + Schedule instead of linking to the nonexistent /estab/meetings/new route", async () => {
    getMeetingsMock.mockResolvedValue({ data: [], source: "api" });
    render(await MeetingsPage({}));
    const scheduleBtn = screen.getByRole("button", { name: /Schedule/ });
    expect(scheduleBtn).toBeDisabled();
  });
});
