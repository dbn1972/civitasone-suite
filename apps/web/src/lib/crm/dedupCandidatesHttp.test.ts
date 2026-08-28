import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as dedup from "./dedupCandidates";

/** Exercises the browserFetch-backed calls by stubbing global fetch. */
function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("dedupCandidates HTTP client (DQ-001)", () => {
  it("mergeDedupPair POSTs the real contacts/merge endpoint with primaryId/duplicateId (left kept, right merged away)", async () => {
    // This used to send PATCH /v1/crm/contacts/:leftId/merge with { mergeIntoId },
    // which does not exist anywhere in crm-service and 404'd unconditionally. The
    // real endpoint is POST /v1/crm/contacts/merge with { primaryId, duplicateId }
    // (contacts/routes.ts + contacts/validators.ts's mergeContactsBody).
    fetchMock.mockResolvedValueOnce(res({ id: "left-1", status: "accepted" }, { status: 202 }));
    await expect(dedup.mergeDedupPair("left-1", "right-2")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("v1/crm/contacts/merge");
    expect(String(url)).not.toContain("left-1/merge");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ primaryId: "left-1", duplicateId: "right-2" });
  });

  it("mergeDedupPair surfaces the server's error message on failure", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "NOT_FOUND", message: "contact not found" }, { status: 404 }));
    await expect(dedup.mergeDedupPair("left-1", "right-2")).rejects.toThrow(/NOT_FOUND/);
  });
});
