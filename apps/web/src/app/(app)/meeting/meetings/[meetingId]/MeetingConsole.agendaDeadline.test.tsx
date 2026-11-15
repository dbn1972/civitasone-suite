/**
 * Adding an agenda item inside the notice window: the console says so (cut-off date, in English / Hindi) instead of
 * a silent 202; the chair can approve a late inclusion with a reason, anyone else is told to ask the chair.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const addAgendaItemMock = vi.fn();
const addLateAgendaItemMock = vi.fn();
vi.mock("../../_data/client", () => ({
  transitionMeeting: vi.fn(),
  addAgendaItem: (...a: unknown[]) => addAgendaItemMock(...a),
  addLateAgendaItem: (...a: unknown[]) => addLateAgendaItemMock(...a),
  AGENDA_OUTCOME_TYPES: ["decision", "discussion", "information", "ratification"],
  MeetingTransitionError: class MeetingTransitionError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  },
  castVote: vi.fn(), concludeVote: vi.fn(), fetchActiveVotes: vi.fn(), fetchLiveAttendance: vi.fn(),
  attendanceCheckIn: vi.fn(), attendanceCheckOut: vi.fn(), initiateVote: vi.fn(),
}));

import { MeetingConsole } from "./MeetingConsole";
import { AgendaSubmitError } from "../../_data/agendaErrors";
import type { Meeting } from "../../_data/types";

const meeting = { id: "m1", type: "committee", title: "Budget Committee", description: null, status: "scheduled", committeeId: null,
  chairpersonId: null, secretaryId: null, scheduledAt: "2026-11-14T04:30:00.000Z", actualStartAt: null, actualEndAt: null,
  durationMinutes: 60, venue: null, vcEnabled: false, vcLink: null, confidentialityLevel: "internal", quorumEstablished: true,
  quorumEstablishedAt: null, meetingNumber: "BC/1", financialYear: null, version: 1 } as unknown as Meeting;

function renderConsole(opts: { locale?: "en" | "hi"; canApproveLateAgenda: boolean }) {
  const messages = (opts.locale === "hi" ? hi : en) as never;
  return rtlRender(
    <NextIntlClientProvider locale={opts.locale ?? "en"} messages={messages}>
      <MeetingConsole meeting={meeting} agenda={[]} agendaSource="api" initialAttendance={null} attendanceSource="api"
        initialActiveVotes={[]} activeVotesSource="api"
        viewerPermissions={{ canTransition: true, canCheckIn: true, canCast: true, canConclude: true, canApproveLateAgenda: opts.canApproveLateAgenda }} />
    </NextIntlClientProvider>,
  );
}
const pastDeadline = () => new AgendaSubmitError("MEETING_PAST_DEADLINE", "x", "2026-11-07T04:30:00.000Z");

async function submitItem(container: HTMLElement, title = "Sanction letter") {
  fireEvent.change(container.querySelector("#mtg-agenda-title")!, { target: { value: title } });
  fireEvent.submit(container.querySelector("#mtg-agenda-title")!.closest("form")!);
}

beforeEach(() => { addAgendaItemMock.mockReset(); addLateAgendaItemMock.mockReset().mockResolvedValue(undefined); });

describe("MeetingConsole -- agenda item past the submission deadline", () => {
  it("English: tells the user the cut-off date and that the chair must approve; a non-chair is told to ask the chair", async () => {
    addAgendaItemMock.mockRejectedValue(pastDeadline());
    const { container } = renderConsole({ canApproveLateAgenda: false });
    await submitItem(container);
    const alert = await waitFor(() => { const a = container.querySelector("#mtg-agenda-past-deadline"); expect(a).not.toBeNull(); return a!; });
    expect(alert).toHaveTextContent(/agenda cut-off for this meeting was .*2026/);
    expect(alert).toHaveTextContent(/needs the chairperson's approval/);
    expect(alert).toHaveTextContent("Ask the chairperson to add this item as a late inclusion.");
    expect(screen.queryByRole("button", { name: /approve and add as late item/i })).toBeNull();
  });

  it("Hindi: the same message in Hindi", async () => {
    addAgendaItemMock.mockRejectedValue(pastDeadline());
    const { container } = renderConsole({ locale: "hi", canApproveLateAgenda: false });
    await submitItem(container);
    const alert = await waitFor(() => { const a = container.querySelector("#mtg-agenda-past-deadline"); expect(a).not.toBeNull(); return a!; });
    expect(alert).toHaveTextContent("कार्यसूची की अंतिम तिथि");
    expect(alert).toHaveTextContent("अध्यक्ष से अनुरोध करें");
    expect(alert).not.toHaveTextContent("cut-off");
  });

  it("the chair gets a reason box; Approve is disabled until the reason is at least 10 characters, then files the late item", async () => {
    addAgendaItemMock.mockRejectedValue(pastDeadline());
    const { container } = renderConsole({ canApproveLateAgenda: true });
    await submitItem(container);
    const approve = await screen.findByRole("button", { name: "Approve and add as late item" });
    expect(approve).toBeDisabled();
    fireEvent.change(container.querySelector("#mtg-agenda-late-reason")!, { target: { value: "short" } });
    expect(approve).toBeDisabled();
    fireEvent.change(container.querySelector("#mtg-agenda-late-reason")!, { target: { value: "Sanction letter arrived after cut-off" } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(addLateAgendaItemMock).toHaveBeenCalledWith("m1", { title: "Sanction letter", outcomeType: "discussion" }, "Sanction letter arrived after cut-off"));
    await waitFor(() => expect(container.querySelector("#mtg-agenda-past-deadline")).toBeNull());
  });

  it("a locked agenda is explained in plain words", async () => {
    addAgendaItemMock.mockRejectedValue(new AgendaSubmitError("MEETING_AGENDA_LOCKED", "x"));
    const { container } = renderConsole({ canApproveLateAgenda: true });
    await submitItem(container);
    expect(await screen.findByText(/The agenda is locked\. Unlock it before adding items\./)).toBeInTheDocument();
    expect(container.querySelector("#mtg-agenda-past-deadline")).toBeNull();
  });
});
