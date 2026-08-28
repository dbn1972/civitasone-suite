import { describe, it, expect, vi, beforeEach } from "vitest";
import { getStewardQueue, decideMerge, type MergeCandidate } from "./steward";

const CANDIDATE: MergeCandidate = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  tenantId: "11111111-0000-0000-0000-000000000001",
  sourceProfileId: "bbbbbbbb-0000-0000-0000-000000000002",
  targetProfileId: "cccccccc-0000-0000-0000-000000000003",
  confidence: "0.9231",
  matchReason: "email + phone match",
  status: "pending",
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  createdAt: "2026-08-20T10:00:00.000Z",
};

describe("getStewardQueue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the merge queue through the BFF proxy and returns source: api", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: [CANDIDATE], meta: { page: 1, pageSize: 50, total: 1 } }), { status: 200 }));

    const { data, source } = await getStewardQueue();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/cdp/steward/queue",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(source).toBe("api");
    expect(data).toEqual([CANDIDATE]);
  });

  it("returns source: error on a non-ok response, never a fabricated empty queue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));

    const { data, source } = await getStewardQueue();

    expect(source).toBe("error");
    expect(data).toEqual([]);
  });

  it("returns source: error on a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const { data, source } = await getStewardQueue();

    expect(source).toBe("error");
    expect(data).toEqual([]);
  });
});

describe("decideMerge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs decision + reason to /v1/cdp/steward/decide with the exact merge request id", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: CANDIDATE.id, status: "accepted" }), { status: 202 }));

    const result = await decideMerge(CANDIDATE.id, "approve", "Same Aadhaar-linked mobile number");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/cdp/steward/decide");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      mergeRequestId: CANDIDATE.id,
      decision: "approve",
      reason: "Same Aadhaar-linked mobile number",
    });
    expect(result).toEqual({ id: CANDIDATE.id, status: "accepted" });
  });

  it("omits the reason key entirely when none is given, matching the optional server schema", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: CANDIDATE.id, status: "accepted" }), { status: 202 }));

    await decideMerge(CANDIDATE.id, "reject");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ mergeRequestId: CANDIDATE.id, decision: "reject" });
    expect("reason" in body).toBe(false);
  });

  it("throws with the server's real code and message on a race (already decided)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "ALREADY_DECIDED", message: "merge request is already approved" }),
        { status: 409 },
      ),
    );

    await expect(decideMerge(CANDIDATE.id, "approve")).rejects.toThrow(
      "ALREADY_DECIDED: merge request is already approved",
    );
  });
});
