/**
 * The add-agenda POST is refused synchronously (422) when it is inside the notice window. The client must
 * surface that as a coded AgendaSubmitError (with the cut-off), not the generic "couldn't save".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserFetch: (...a: unknown[]) => browserFetch(...a) }));

import { addAgendaItem, addLateAgendaItem, requestLateAgendaItem, fetchLateRequests, approveLateRequest, rejectLateRequest } from "./client";
import { AgendaSubmitError, asAgendaSubmitError } from "./agendaErrors";

beforeEach(() => browserFetch.mockReset());
const json = (b: unknown, status: number) => new Response(JSON.stringify(b), { status });

describe("addAgendaItem refusals", () => {
  it("MEETING_PAST_DEADLINE (flat body, as the service sends it) -> AgendaSubmitError with the cut-off", async () => {
    browserFetch.mockResolvedValue(json({ code: "MEETING_PAST_DEADLINE", message: "x", deadline: "2026-11-05T10:00:00.000Z", scheduledAt: "2026-11-12T10:00:00.000Z" }, 422));
    const err = await addAgendaItem("m1", { title: "t", outcomeType: "decision" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgendaSubmitError);
    expect(asAgendaSubmitError(err)).toMatchObject({ code: "MEETING_PAST_DEADLINE", deadline: "2026-11-05T10:00:00.000Z" });
  });

  it("also reads the nested { error: { details } } envelope", async () => {
    browserFetch.mockResolvedValue(json({ error: { code: "MEETING_PAST_DEADLINE", details: { deadline: "2026-11-05T10:00:00.000Z" } } }, 422));
    const err = await addAgendaItem("m1", { title: "t", outcomeType: "decision" }).catch((e: unknown) => e);
    expect(asAgendaSubmitError(err)?.deadline).toBe("2026-11-05T10:00:00.000Z");
  });

  it("MEETING_AGENDA_LOCKED is coded too; an unrelated failure stays the generic message", async () => {
    browserFetch.mockResolvedValue(json({ code: "MEETING_AGENDA_LOCKED" }, 422));
    expect(asAgendaSubmitError(await addAgendaItem("m1", { title: "t", outcomeType: "decision" }).catch((e: unknown) => e))?.code).toBe("MEETING_AGENDA_LOCKED");
    browserFetch.mockResolvedValue(json({ code: "INTERNAL" }, 500));
    const generic = await addAgendaItem("m1", { title: "t", outcomeType: "decision" }).catch((e: unknown) => e);
    expect(asAgendaSubmitError(generic)).toBeNull();
    expect(generic).toBeInstanceOf(Error);
  });
});

describe("addLateAgendaItem", () => {
  it("posts title, outcomeType and the reason to .../agenda/late", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await addLateAgendaItem("m1", { title: "Budget", outcomeType: "decision" }, "Sanction arrived late");
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/meeting/m1/agenda/late");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Budget", outcomeType: "decision", reason: "Sanction arrived late" });
  });
});

describe("stored late-inclusion requests", () => {
  it("requestLateAgendaItem posts to .../agenda/late-requests with the reason", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await requestLateAgendaItem("m1", { title: "Budget", outcomeType: "decision" }, "Sanction arrived late");
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/meeting/m1/agenda/late-requests");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Budget", outcomeType: "decision", reason: "Sanction arrived late" });
  });
  it("fetchLateRequests maps the list", async () => {
    browserFetch.mockResolvedValue(json({ data: [{ id: "r1", meetingId: "m1", title: "t", outcomeType: "decision", reason: "why", status: "pending", requestedBy: "u", requestedAt: "2026-11-10T00:00:00Z" }] }, 200));
    const out = await fetchLateRequests("m1");
    expect(browserFetch.mock.calls[0]![0]).toBe("v1/meeting/m1/agenda/late-requests");
    expect(out[0]).toMatchObject({ id: "r1", status: "pending", decidedBy: null, agendaItemId: null });
  });
  it("approve / reject hit the decision routes; reject carries the reason", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await approveLateRequest("m1", "r1");
    await rejectLateRequest("m1", "r1", "Can wait");
    expect(browserFetch.mock.calls[0]![0]).toBe("v1/meeting/m1/agenda/late-requests/r1/approve");
    expect(browserFetch.mock.calls[1]![0]).toBe("v1/meeting/m1/agenda/late-requests/r1/reject");
    expect(JSON.parse((browserFetch.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ reason: "Can wait" });
  });
  it("maker-checker and already-decided refusals are coded", async () => {
    browserFetch.mockResolvedValue(json({ code: "SELF_APPROVAL_FORBIDDEN" }, 403));
    expect(asAgendaSubmitError(await approveLateRequest("m1", "r1").catch((e: unknown) => e))?.code).toBe("SELF_APPROVAL_FORBIDDEN");
    browserFetch.mockResolvedValue(json({ code: "LATE_REQUEST_ALREADY_DECIDED" }, 409));
    expect(asAgendaSubmitError(await approveLateRequest("m1", "r1").catch((e: unknown) => e))?.code).toBe("LATE_REQUEST_ALREADY_DECIDED");
  });
});
