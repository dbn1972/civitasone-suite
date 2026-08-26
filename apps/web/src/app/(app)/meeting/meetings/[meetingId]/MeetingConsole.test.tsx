import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const transitionMeetingMock = vi.fn();
const castVoteMock = vi.fn();
const concludeVoteMock = vi.fn();
const fetchActiveVotesMock = vi.fn();
const fetchLiveAttendanceMock = vi.fn();
const attendanceCheckInMock = vi.fn();
const attendanceCheckOutMock = vi.fn();
const initiateVoteMock = vi.fn();

vi.mock("../../_data/client", () => ({
  transitionMeeting: (...args: unknown[]) => transitionMeetingMock(...args),
  castVote: (...args: unknown[]) => castVoteMock(...args),
  concludeVote: (...args: unknown[]) => concludeVoteMock(...args),
  fetchActiveVotes: (...args: unknown[]) => fetchActiveVotesMock(...args),
  fetchLiveAttendance: (...args: unknown[]) => fetchLiveAttendanceMock(...args),
  attendanceCheckIn: (...args: unknown[]) => attendanceCheckInMock(...args),
  attendanceCheckOut: (...args: unknown[]) => attendanceCheckOutMock(...args),
  initiateVote: (...args: unknown[]) => initiateVoteMock(...args),
}));

import { MeetingConsole } from "./MeetingConsole";
import type { ActiveVote, Meeting } from "../../_data/types";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    type: "committee",
    title: "Budget Committee — Q3",
    description: null,
    status: "in_progress",
    committeeId: null,
    chairpersonId: null,
    secretaryId: null,
    scheduledAt: "2026-09-01T04:30:00.000Z",
    actualStartAt: null,
    actualEndAt: null,
    durationMinutes: 60,
    venue: null,
    vcEnabled: false,
    vcLink: null,
    confidentialityLevel: "internal",
    quorumEstablished: true,
    quorumEstablishedAt: null,
    meetingNumber: "BC/2026/03",
    financialYear: null,
    version: 1,
    ...overrides,
  };
}

function activeVote(overrides: Partial<ActiveVote> = {}): ActiveVote {
  return {
    resolutionId: "r1",
    meetingId: "m1",
    resolutionNumber: "RES-1",
    text: "Approve the Q3 budget.",
    voteType: "show_of_hands",
    majorityRule: "simple_majority",
    status: "open",
    isCirculation: false,
    tally: { votesFor: 2, votesAgainst: 0, votesAbstain: 0, total: 2 },
    circulationDeadline: null,
    createdAt: "2026-09-01T04:00:00.000Z",
    ...overrides,
  };
}

function baseProps() {
  return {
    meeting: meeting(),
    agenda: [],
    agendaSource: "api" as const,
    initialAttendance: null,
    attendanceSource: "api" as const,
    initialActiveVotes: [activeVote()],
    activeVotesSource: "api" as const,
  };
}

describe("MeetingConsole — danger transition confirmation (fix 2)", () => {
  beforeEach(() => {
    transitionMeetingMock.mockReset();
  });

  it("renders the danger transition with the danger button class, not ghost", () => {
    render(<MeetingConsole {...baseProps()} />);
    const btn = screen.getByRole("button", { name: "Adjourn meeting" });
    expect(btn).toHaveClass("danger");
    expect(btn).not.toHaveClass("ghost");
  });

  it("does not call transitionMeeting until the confirm dialog is accepted", () => {
    render(<MeetingConsole {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjourn meeting" }));
    expect(transitionMeetingMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Adjourning ends the live session/)).toBeInTheDocument();
  });

  it("calls transitionMeeting only after confirming", async () => {
    transitionMeetingMock.mockResolvedValue(undefined);
    render(<MeetingConsole {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjourn meeting" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Adjourn meeting" }));
    await waitFor(() => expect(transitionMeetingMock).toHaveBeenCalledWith("m1", "adjourned"));
  });

  it("a non-danger transition still fires immediately without a dialog", async () => {
    transitionMeetingMock.mockResolvedValue(undefined);
    render(<MeetingConsole {...baseProps()} meeting={meeting({ status: "scheduled" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(transitionMeetingMock).toHaveBeenCalledWith("m1", "in_progress"));
  });
});

describe("MeetingConsole — vote cast confirmation and my-vote indicator (fix 1, fix 7)", () => {
  beforeEach(() => {
    castVoteMock.mockReset();
    fetchActiveVotesMock.mockReset().mockResolvedValue([activeVote()]);
  });

  it("does not call castVote until the confirm dialog is accepted", () => {
    render(<MeetingConsole {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cast: For" }));
    expect(castVoteMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/records your position against your name/)).toBeInTheDocument();
  });

  it("casts the vote after confirming and shows a you-voted indicator, disabling the cast buttons", async () => {
    castVoteMock.mockResolvedValue(undefined);
    render(<MeetingConsole {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cast: For" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cast: For" }));

    await waitFor(() =>
      expect(castVoteMock).toHaveBeenCalledWith("m1", { resolutionId: "r1", position: "for" }),
    );
    expect(await screen.findByText("✓ You voted: For")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cast: Against" })).not.toBeInTheDocument();
  });

  it("secret-ballot resolutions get anonymity-specific confirmation copy", () => {
    render(
      <MeetingConsole
        {...baseProps()}
        initialActiveVotes={[activeVote({ voteType: "secret_ballot" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cast: Abstain" }));
    expect(screen.getByText(/individual position is withheld/)).toBeInTheDocument();
  });
});

describe("MeetingConsole — ErrorState for genuine load failures (fix 8)", () => {
  it("shows ErrorState with a working retry when votes failed to load", async () => {
    fetchActiveVotesMock.mockReset().mockResolvedValue([]);
    render(<MeetingConsole {...baseProps()} activeVotesSource="error" initialActiveVotes={[]} />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.getByText("The voting panel couldn't be reached.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchActiveVotesMock).toHaveBeenCalled());
  });

  it("shows ErrorState (not the plain empty state) when attendance failed to load", () => {
    render(<MeetingConsole {...baseProps()} attendanceSource="error" initialAttendance={null} />);
    expect(screen.getByText("The live attendance dashboard couldn't be reached.")).toBeInTheDocument();
  });

  it("shows ErrorState when the agenda failed to load, retry triggers router.refresh", () => {
    refreshMock.mockClear();
    render(<MeetingConsole {...baseProps()} agendaSource="error" agenda={[]} />);
    expect(screen.getByText("The agenda couldn't be reached.")).toBeInTheDocument();
    const agendaRetry = screen.getAllByRole("button", { name: "Try again" })[0];
    fireEvent.click(agendaRetry);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("keeps the plain EmptyState for a genuinely empty (not erroring) agenda", () => {
    render(<MeetingConsole {...baseProps()} agendaSource="api" agenda={[]} />);
    expect(screen.getByText("No agenda items yet")).toBeInTheDocument();
    expect(screen.queryByText("The agenda couldn't be reached.")).not.toBeInTheDocument();
  });
});
