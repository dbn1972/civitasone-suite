/**
 * UAT J14 / M1-M3: on-screen check-in sent { participantId, mode } but
 * meeting-service attendanceCheckInSchema requires `method` (strict), so every
 * check-in was a 400. Also pins the add-participants + committee picker calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserFetch: (...a: unknown[]) => browserFetch(...a) }));

import { attendanceCheckIn, addParticipants, listCommitteeMembers, listCommittees } from "./client";

beforeEach(() => browserFetch.mockReset());

const body = () => JSON.parse((browserFetch.mock.calls[0] as [string, RequestInit])[1].body as string);

describe("attendanceCheckIn", () => {
  it("sends method=manual (required by the service) with the participant id", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await attendanceCheckIn("m1", "p1");
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/meeting/m1/attendance/check-in");
    expect(body()).toEqual({ participantId: "p1", method: "manual" });
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });

  it("passes an explicit attendance mode through alongside the method", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    await attendanceCheckIn("m1", "p1", { mode: "vc" });
    expect(body()).toEqual({ participantId: "p1", method: "manual", mode: "vc" });
  });
});

describe("addParticipants", () => {
  it("posts a { participants } batch with an idempotency key", async () => {
    browserFetch.mockResolvedValue(new Response("", { status: 202 }));
    const e = "0b6f1c1e-5a53-4a52-9d57-6f2d1b0c7a11";
    await addParticipants("m1", [{ employeeId: e, role: "member" }]);
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/meeting/m1/participants");
    expect(init.method).toBe("POST");
    expect(body()).toEqual({ participants: [{ employeeId: e, role: "member" }] });
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });
});

describe("listCommitteeMembers", () => {
  it("returns only active members as { employeeId, role }", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ data: [
      { memberId: "e1", role: "chairperson", status: "active" },
      { memberId: "e2", role: "member", status: "inactive" },
      { memberId: "e3", role: "secretary", status: "active" },
    ] }), { status: 200 }));
    const out = await listCommitteeMembers("c1");
    expect(browserFetch.mock.calls[0][0]).toBe("v1/meeting/committees/c1/members");
    expect(out).toEqual([{ employeeId: "e1", role: "chairperson" }, { employeeId: "e3", role: "secretary" }]);
  });
});

describe("listCommittees", () => {
  it("asks for the service maximum page so the picker is not capped at the default page", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await listCommittees();
    expect(browserFetch.mock.calls[0][0]).toBe("v1/meeting/committees?limit=200");
  });
});
