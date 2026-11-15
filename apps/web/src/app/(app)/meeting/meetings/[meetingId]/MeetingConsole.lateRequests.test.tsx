/**
 * Stored late-inclusion flow in the console (English + Hindi): the add-agenda form follows the SERVER's
 * write roles (the chairperson decides, they do not author), a secretary/member requests with a reason,
 * and the chair sees pending requests and approves or rejects them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

const addAgendaItemMock = vi.fn();
const requestLateMock = vi.fn();
const fetchLateMock = vi.fn();
const approveMock = vi.fn();
const rejectMock = vi.fn();
vi.mock("../../_data/client", () => ({
  transitionMeeting: vi.fn(),
  addAgendaItem: (...a: unknown[]) => addAgendaItemMock(...a),
  addLateAgendaItem: vi.fn(),
  requestLateAgendaItem: (...a: unknown[]) => requestLateMock(...a),
  fetchLateRequests: (...a: unknown[]) => fetchLateMock(...a),
  approveLateRequest: (...a: unknown[]) => approveMock(...a),
  rejectLateRequest: (...a: unknown[]) => rejectMock(...a),
  AGENDA_OUTCOME_TYPES: ["decision", "discussion", "information", "ratification"],
  MeetingTransitionError: class MeetingTransitionError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  },
  castVote: vi.fn(), concludeVote: vi.fn(), fetchActiveVotes: vi.fn(), fetchLiveAttendance: vi.fn(),
  attendanceCheckIn: vi.fn(), attendanceCheckOut: vi.fn(), initiateVote: vi.fn(),
}));

import { MeetingConsole } from "./MeetingConsole";
import { AgendaSubmitError } from "../../_data/agendaErrors";
import type { Meeting, LateAgendaRequest } from "../../_data/types";

const meeting = { id: "m1", type: "committee", title: "Budget Committee", description: null, status: "scheduled", committeeId: null,
  chairpersonId: null, secretaryId: null, scheduledAt: "2026-11-14T04:30:00.000Z", actualStartAt: null, actualEndAt: null,
  durationMinutes: 60, venue: null, vcEnabled: false, vcLink: null, confidentialityLevel: "internal", quorumEstablished: true,
  quorumEstablishedAt: null, meetingNumber: "BC/1", financialYear: null, version: 1 } as unknown as Meeting;

type Perms = { canTransition: boolean; canAddAgenda?: boolean; canApproveLateAgenda?: boolean; canRequestLateAgenda?: boolean };
function renderConsole(perms: Perms, locale: "en" | "hi" = "en") {
  return rtlRender(
    <NextIntlClientProvider locale={locale} messages={(locale === "hi" ? hi : en) as never}>
      <MeetingConsole meeting={meeting} agenda={[]} agendaSource="api" initialAttendance={null} attendanceSource="api"
        initialActiveVotes={[]} activeVotesSource="api"
        viewerPermissions={{ canCheckIn: true, canCast: true, canConclude: true, ...perms }} />
    </NextIntlClientProvider>,
  );
}
const req = (o: Partial<LateAgendaRequest> = {}): LateAgendaRequest => ({
  id: "r1", meetingId: "m1", title: "Sanction letter", outcomeType: "discussion", reason: "Arrived after cut-off", status: "pending",
  requestedBy: "u-sec", requestedAt: "2026-11-10T04:30:00.000Z", decidedBy: null, decidedAt: null, decisionReason: null, agendaItemId: null, ...o });
const pastDeadline = () => new AgendaSubmitError("MEETING_PAST_DEADLINE", "x", "2026-11-07T04:30:00.000Z");
const submitItem = (c: HTMLElement) => {
  fireEvent.change(c.querySelector("#mtg-agenda-title")!, { target: { value: "Sanction letter" } });
  fireEvent.submit(c.querySelector("#mtg-agenda-title")!.closest("form")!);
};

beforeEach(() => {
  for (const m of [addAgendaItemMock, requestLateMock, fetchLateMock, approveMock, rejectMock]) m.mockReset();
  requestLateMock.mockResolvedValue(undefined); approveMock.mockResolvedValue(undefined); rejectMock.mockResolvedValue(undefined);
  fetchLateMock.mockResolvedValue([]);
});

describe("add-agenda form follows the server's write roles", () => {
  it("a chairperson (canTransition, but not an agenda writer) does not get the form", () => {
    const { container } = renderConsole({ canTransition: true, canAddAgenda: false, canApproveLateAgenda: true });
    expect(container.querySelector("#mtg-agenda-title")).toBeNull();
  });
  it("a secretary (agenda writer) does", () => {
    const { container } = renderConsole({ canTransition: false, canAddAgenda: true });
    expect(container.querySelector("#mtg-agenda-title")).not.toBeNull();
  });
});

describe("requesting a late inclusion", () => {
  it("English: past the cut-off the secretary gets a reason box; Request is enabled at 10+ chars and sends the stored request", async () => {
    addAgendaItemMock.mockRejectedValue(pastDeadline());
    const { container } = renderConsole({ canTransition: false, canAddAgenda: true, canRequestLateAgenda: true });
    submitItem(container);
    const btn = await screen.findByRole("button", { name: "Request late inclusion" });
    expect(btn).toBeDisabled();
    fireEvent.change(container.querySelector("#mtg-agenda-late-reason")!, { target: { value: "Sanction letter arrived after cut-off" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(requestLateMock).toHaveBeenCalledWith("m1", { title: "Sanction letter", outcomeType: "discussion" }, "Sanction letter arrived after cut-off"));
    expect(await screen.findByText(/Request sent to the chairperson/)).toBeInTheDocument();
  });

  it("Hindi: the request button and intro are in Hindi", async () => {
    addAgendaItemMock.mockRejectedValue(pastDeadline());
    const { container } = renderConsole({ canTransition: false, canAddAgenda: true, canRequestLateAgenda: true }, "hi");
    submitItem(container);
    expect(await screen.findByRole("button", { name: "विलंबित समावेशन का अनुरोध करें" })).toBeInTheDocument();
    expect(container.querySelector("#mtg-agenda-past-deadline")).toHaveTextContent("अध्यक्ष से अंतिम तिथि के बाद भी");
  });
});

describe("the chairperson's pending requests", () => {
  it("lists a pending request and approves it (no ids shown); the status flips and the agenda is refreshed", async () => {
    fetchLateMock.mockResolvedValue([req()]);
    renderConsole({ canTransition: true, canAddAgenda: false, canApproveLateAgenda: true });
    const row = await screen.findByTestId("late-request-r1");
    expect(row).toHaveTextContent("Sanction letter");
    expect(row).toHaveTextContent("Awaiting chairperson");
    expect(row).toHaveTextContent("Reason: Arrived after cut-off");
    expect(row).not.toHaveTextContent("u-sec");
    fireEvent.click(screen.getByRole("button", { name: "Approve and add to agenda" }));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("m1", "r1"));
    await waitFor(() => expect(row).toHaveTextContent("Approved"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("rejecting needs a reason of 5+ characters, then sends it", async () => {
    fetchLateMock.mockResolvedValue([req()]);
    const { container } = renderConsole({ canTransition: true, canApproveLateAgenda: true });
    await screen.findByTestId("late-request-r1");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = screen.getByRole("button", { name: "Reject request" });
    expect(confirm).toBeDisabled();
    fireEvent.change(container.querySelector("#mtg-late-reject-r1")!, { target: { value: "Can wait for the next meeting" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith("m1", "r1", "Can wait for the next meeting"));
  });

  it("maker != checker: a 403 SELF_APPROVAL_FORBIDDEN is explained, and the request stays pending", async () => {
    fetchLateMock.mockResolvedValue([req()]);
    approveMock.mockRejectedValue(new AgendaSubmitError("SELF_APPROVAL_FORBIDDEN", "x"));
    renderConsole({ canTransition: true, canApproveLateAgenda: true });
    const row = await screen.findByTestId("late-request-r1");
    fireEvent.click(screen.getByRole("button", { name: "Approve and add to agenda" }));
    expect(await screen.findByText(/You cannot decide a request you made yourself/)).toBeInTheDocument();
    expect(row).toHaveTextContent("Awaiting chairperson");
  });

  it("a requester (no approve right) sees the status but no decision buttons; Hindi labels render", async () => {
    fetchLateMock.mockResolvedValue([req({ status: "rejected", decisionReason: "Can wait" })]);
    renderConsole({ canTransition: false, canAddAgenda: true, canRequestLateAgenda: true }, "hi");
    const row = await screen.findByTestId("late-request-r1");
    expect(row).toHaveTextContent("अस्वीकृत");
    expect(row).toHaveTextContent("निर्णय: Can wait");
    expect(screen.queryByRole("button", { name: /स्वीकृत करें/ })).toBeNull();
  });

  it("viewers with neither right never call the list endpoint", () => {
    renderConsole({ canTransition: true, canAddAgenda: true });
    expect(fetchLateMock).not.toHaveBeenCalled();
  });
});
