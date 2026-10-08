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

  it("mergeDedupPair throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "NOT_FOUND", message: "contact not found" }, { status: 404 }));
    await expect(dedup.mergeDedupPair("left-1", "right-2")).rejects.toThrow("We couldn't find this information. It may have been removed or the link may be wrong.");
    fetchMock.mockResolvedValueOnce(res({ code: "NOT_FOUND", message: "contact not found" }, { status: 404 }));
    await expect(dedup.mergeDedupPair("left-1", "right-2")).rejects.not.toThrow(/NOT_FOUND|contact not found/);
  });

  it("GAP-CRM-DEDUP-CANDIDATES-07: all calls use the module 'v1/...' convention and resolve to a single-slash proxy path", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    await dedup.getDedupCandidates();
    fetchMock.mockResolvedValueOnce(res({ id: "x" }, { status: 202 }));
    await dedup.mergeDedupPair("a", "b");
    fetchMock.mockResolvedValueOnce(res({}, { status: 202 }));
    await dedup.dismissDedupPair("pair-1");

    const urls = fetchMock.mock.calls.map((c) => String((c as [string])[0]));
    for (const u of urls) {
      // browserFetch strips a single leading slash and prefixes /api/proxy/, so
      // the final path must be exactly /api/proxy/v1/... with no // after proxy.
      expect(u).toContain("/api/proxy/v1/crm/contacts/");
      expect(u).not.toContain("/api/proxy//");
    }
  });

  it("GAP2-CRM-DEDUP-CANDIDATES-07: getDedupCandidates returns the live pairs with source 'api' on 200", async () => {
    const pair = {
      pairId: "a:b",
      confidence: 85,
      left: { id: "a", name: "Priya", email: null, phone: null, company: "Nimbus", lastActivity: null },
      right: { id: "b", name: "Priya", email: null, phone: null, company: "Nimbus", lastActivity: null },
    };
    fetchMock.mockResolvedValueOnce(res({ data: [pair] }));
    const out = await dedup.getDedupCandidates();
    expect(out.source).toBe("api");
    expect(out.data).toHaveLength(1);
    expect(out.data[0]!.pairId).toBe("a:b");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toContain("v1/crm/contacts/dedup-candidates");
  });

  it("GAP2-CRM-DEDUP-CANDIDATES-07: getDedupCandidates fails closed to source 'error' on a non-2xx (honest badge, not a fake empty)", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "BOOM" }, { status: 500 }));
    const out = await dedup.getDedupCandidates();
    expect(out.source).toBe("error");
    expect(out.data).toEqual([]);
  });

  it("GAP2-CRM-DEDUP-CANDIDATES-07: dismissDedupPair PATCHes the real dismiss route and resolves on 200", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: { pairId: "a:b" } }, { status: 200 }));
    await expect(dedup.dismissDedupPair("a:b", "distinct people")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("v1/crm/contacts/dedup-candidates/a:b/dismiss");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "distinct people" });
  });
});
