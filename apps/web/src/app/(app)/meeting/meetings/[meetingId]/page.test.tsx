import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getMeetingMock = vi.fn();
const getAgendaMock = vi.fn();
const getLiveAttendanceMock = vi.fn();
const getActiveVotesMock = vi.fn();
vi.mock("../../_data/loaders", () => ({
  getMeeting: (...a: unknown[]) => getMeetingMock(...a),
  getAgenda: (...a: unknown[]) => getAgendaMock(...a),
  getLiveAttendance: (...a: unknown[]) => getLiveAttendanceMock(...a),
  getActiveVotes: (...a: unknown[]) => getActiveVotesMock(...a),
}));

// MeetingConsole is a heavy client component; stub it since these tests only
// exercise the page's error-branching.
vi.mock("./MeetingConsole", () => ({ MeetingConsole: () => <div data-testid="console" /> }));

import MeetingConsolePage from "./page";

describe("MeetingConsolePage — status-aware error states (GAP-MEETING-MEETINGS-MEETINGID-05)", () => {
  beforeEach(() => {
    getMeetingMock.mockReset();
    getAgendaMock.mockReset().mockResolvedValue({ data: [], source: "api" });
    getLiveAttendanceMock.mockReset().mockResolvedValue({ data: null, source: "api" });
    getActiveVotesMock.mockReset().mockResolvedValue({ data: [], source: "api" });
  });

  it("404 shows not-found copy with NO retry", async () => {
    getMeetingMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await MeetingConsolePage({ params: { meetingId: "x" } }));
    expect(screen.getByText("Meeting not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("403 shows access-denied copy with NO retry", async () => {
    getMeetingMock.mockResolvedValue({ data: null, source: "error", status: 403 });
    render(await MeetingConsolePage({ params: { meetingId: "x" } }));
    expect(screen.getByText("You don't have access to this meeting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("a transient failure (503) shows a retry control", async () => {
    getMeetingMock.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await MeetingConsolePage({ params: { meetingId: "x" } }));
    expect(screen.getByText("This meeting couldn't be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders the console when the meeting loads", async () => {
    getMeetingMock.mockResolvedValue({
      data: { id: "m1", title: "Budget", status: "in_progress", type: "committee" },
      source: "api",
    });
    render(await MeetingConsolePage({ params: { meetingId: "m1" } }));
    expect(screen.getByTestId("console")).toBeInTheDocument();
  });
});
