/**
 * UAT J14 / M2: the meeting console had no way to add participants, and picking
 * a committee on the meeting never put its members on the roster. The console
 * now offers "Add committee members" (the meeting's committee) and a single
 * employee add, both via POST /participants.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock("@/app/_components/EmployeePicker", () => ({
  EmployeePicker: (p: { onChange: (id: string | null, o: null) => void; directory?: string }) => (
    <button type="button" data-directory={p.directory} onClick={() => p.onChange("8d1f0a52-6c1e-4b0a-9d0e-2f6d7a3c5b10", null)}>pick-employee</button>
  ),
}));

const addParticipantsMock = vi.fn();
const listCommitteeMembersMock = vi.fn();
const listParticipantEmployeeIdsMock = vi.fn();
const fetchLiveAttendanceMock = vi.fn();
vi.mock("../../_data/client", () => ({
  transitionMeeting: vi.fn(),
  addAgendaItem: vi.fn(),
  AGENDA_OUTCOME_TYPES: ["decision", "discussion", "information", "ratification"],
  PARTICIPANT_ROLES: ["member", "chairperson", "secretary", "observer", "presenter"],
  MeetingTransitionError: class MeetingTransitionError extends Error {},
  castVote: vi.fn(),
  concludeVote: vi.fn(),
  fetchActiveVotes: vi.fn().mockResolvedValue([]),
  fetchLiveAttendance: (...a: unknown[]) => fetchLiveAttendanceMock(...a),
  attendanceCheckIn: vi.fn(),
  attendanceCheckOut: vi.fn(),
  initiateVote: vi.fn(),
  addParticipants: (...a: unknown[]) => addParticipantsMock(...a),
  listCommitteeMembers: (...a: unknown[]) => listCommitteeMembersMock(...a),
  listParticipantEmployeeIds: (...a: unknown[]) => listParticipantEmployeeIdsMock(...a),
}));

import { MeetingConsole } from "./MeetingConsole";
import type { Meeting } from "../../_data/types";

const E1 = "11111111-aaaa-4aaa-8aaa-000000000001";
const E2 = "11111111-aaaa-4aaa-8aaa-000000000002";
const E3 = "11111111-aaaa-4aaa-8aaa-000000000003";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1", type: "committee", title: "Finance Committee — Q3", description: null, status: "draft",
    committeeId: "c1", chairpersonId: null, secretaryId: null, scheduledAt: "2026-09-01T04:30:00.000Z",
    actualStartAt: null, actualEndAt: null, durationMinutes: 60, venue: null, vcEnabled: false, vcLink: null,
    confidentialityLevel: "internal", quorumEstablished: false, quorumEstablishedAt: null,
    meetingNumber: "FC/2026/03", financialYear: null, version: 1, ...overrides,
  };
}

function props(over: Record<string, unknown> = {}, canManageParticipants = true, employeeDirectory: "hrms" | "payroll" | "none" = "hrms") {
  return {
    meeting: meeting(),
    agenda: [],
    agendaSource: "api" as const,
    initialAttendance: {
      participants: [{ participantId: "p1", employeeId: E1, role: "member", status: "absent", isMandatory: true, checkInAt: null }],
    } as never,
    attendanceSource: "api" as const,
    initialActiveVotes: [],
    activeVotesSource: "api" as const,
    viewerPermissions: { canTransition: true, canCheckIn: true, canCast: true, canConclude: true, canManageParticipants, employeeDirectory },
    ...over,
  };
}

beforeEach(() => {
  addParticipantsMock.mockReset().mockResolvedValue(undefined);
  listCommitteeMembersMock.mockReset();
  listParticipantEmployeeIdsMock.mockReset().mockResolvedValue([E1]);
  fetchLiveAttendanceMock.mockReset().mockResolvedValue({ participants: [] });
});

describe("MeetingConsole — add participants (M2)", () => {
  it("adds the committee's members, skipping anyone already on the roster", async () => {
    listCommitteeMembersMock.mockResolvedValue([
      { employeeId: E1, role: "member" },
      { employeeId: E2, role: "chairperson" },
      { employeeId: E3, role: "secretary" },
    ]);
    render(<MeetingConsole {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /add committee members/i }));
    await waitFor(() => expect(addParticipantsMock).toHaveBeenCalledTimes(1));
    expect(listCommitteeMembersMock).toHaveBeenCalledWith("c1");
    expect(addParticipantsMock).toHaveBeenCalledWith("m1", [
      { employeeId: E2, role: "chairperson" },
      { employeeId: E3, role: "secretary" },
    ]);
  });

  it("says so, and posts nothing, when every committee member is already on the roster", async () => {
    listCommitteeMembersMock.mockResolvedValue([{ employeeId: E1, role: "member" }]);
    render(<MeetingConsole {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /add committee members/i }));
    expect(await screen.findByText(/already on the roster/i)).toBeInTheDocument();
    expect(addParticipantsMock).not.toHaveBeenCalled();
  });

  it("adds one picked employee with the chosen role", async () => {
    render(<MeetingConsole {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "pick-employee" }));
    fireEvent.change(screen.getByLabelText(/participant role/i), { target: { value: "observer" } });
    fireEvent.click(screen.getByRole("button", { name: /^add participant$/i }));
    await waitFor(() => expect(addParticipantsMock).toHaveBeenCalledWith("m1", [
      { employeeId: "8d1f0a52-6c1e-4b0a-9d0e-2f6d7a3c5b10", role: "observer" },
    ]));
  });

  it("hides the committee button when the meeting has no committee", () => {
    render(<MeetingConsole {...props({ meeting: meeting({ committeeId: null }) })} />);
    expect(screen.queryByRole("button", { name: /add committee members/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pick-employee" })).toBeInTheDocument();
  });

  it("hides every add control for a viewer without the participants-write role", () => {
    render(<MeetingConsole {...props({}, false)} />);
    expect(screen.queryByRole("button", { name: /add committee members/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pick-employee" })).not.toBeInTheDocument();
  });

  it("passes the directory derived from the viewer's roles to the employee picker", () => {
    render(<MeetingConsole {...props({}, true, "payroll")} />);
    expect(screen.getByRole("button", { name: "pick-employee" })).toHaveAttribute("data-directory", "payroll");
  });

  it("hides the single-add picker when the viewer's roles can reach no employee directory, keeping the committee add", () => {
    render(<MeetingConsole {...props({}, true, "none")} />);
    expect(screen.queryByRole("button", { name: "pick-employee" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add committee members/i })).toBeInTheDocument();
  });

  it("diffs against a fresh roster (not the held one) and disables the add until the roster reflects it", async () => {
    // Held roster has only E1; the server already has E2 too (stale view).
    listParticipantEmployeeIdsMock.mockResolvedValue([E1, E2]);
    listCommitteeMembersMock.mockResolvedValue([
      { employeeId: E2, role: "chairperson" },
      { employeeId: E3, role: "secretary" },
    ]);
    render(<MeetingConsole {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /add committee members/i }));
    await waitFor(() => expect(addParticipantsMock).toHaveBeenCalledTimes(1));
    expect(addParticipantsMock).toHaveBeenCalledWith("m1", [{ employeeId: E3, role: "secretary" }]);
    expect(await screen.findByText(/submitted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add committee members/i })).toBeDisabled();
  });
});
