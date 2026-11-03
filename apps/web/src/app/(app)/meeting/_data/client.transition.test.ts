/**
 * UAT J14 / D9: the console sent `{ toState }` to POST /v1/meeting/:id/transition,
 * which meeting-service's transitionMeetingSchema (`{ version, to, reason? }`)
 * rejects with 400 -- so no lifecycle button ever worked. Pins the body and the
 * coded refusal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserFetch: (...a: unknown[]) => browserFetch(...a) }));

import { transitionMeeting, addAgendaItem, MeetingTransitionError } from "./client";

beforeEach(() => browserFetch.mockReset());

describe("transitionMeeting", () => {
  it("posts { version, to, reason } to the transition route", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: "m1", status: "accepted" } }), { status: 202 }));
    await transitionMeeting("m1", "adjourned", 3, "Power failure");
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/meeting/m1/transition");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ version: 3, to: "adjourned", reason: "Power failure" });
  });

  it("omits reason when none is given", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await transitionMeeting("m1", "scheduled", 1);
    expect(JSON.parse((browserFetch.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ version: 1, to: "scheduled" });
  });

  it("throws a MeetingTransitionError carrying the service code on a refusal it explains", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ code: "MEETING_INVALID_TRANSITION", message: "x" }), { status: 422 }));
    await expect(transitionMeeting("m1", "in_progress", 1)).rejects.toMatchObject({ code: "MEETING_INVALID_TRANSITION" });
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ code: "MEETING_INVALID_TRANSITION" }), { status: 422 }));
    await expect(transitionMeeting("m1", "in_progress", 1)).rejects.toBeInstanceOf(MeetingTransitionError);
  });
});

describe("addAgendaItem", () => {
  it("posts title + outcomeType to the agenda route", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await addAgendaItem("m1", { title: "Budget", outcomeType: "decision" });
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/meeting/m1/agenda");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Budget", outcomeType: "decision" });
  });
});
