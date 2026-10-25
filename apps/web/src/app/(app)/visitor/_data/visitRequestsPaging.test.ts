/**
 * CLOS3-S6-15 follow-up: the visit-request list is capped server-side, so the
 * web loaders must follow meta.hasMore instead of reading only page 1.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));
const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => browserFetchMock(...a),
}));

import { getVisitRequests } from "./loaders";
import { fetchVisitRequests } from "./client";

const row = (id: string) => ({ id, status: "pending_approval" });

/** Emulates fetchJson: runs mapResponse over the canned page payload. */
function servePages(pages: Array<{ data: unknown[]; hasMore: boolean } | "error">) {
  let i = 0;
  fetchJsonMock.mockImplementation(async (_path: string, empty: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    const page = pages[i++];
    if (page === "error") return { data: empty, source: "error" };
    const payload = { data: page.data, meta: { hasMore: page.hasMore } };
    return { data: opts.mapResponse(payload), source: "api" };
  });
}

beforeEach(() => {
  fetchJsonMock.mockReset();
  browserFetchMock.mockReset();
});

describe("getVisitRequests pagination", () => {
  it("follows meta.hasMore and concatenates every page", async () => {
    servePages([
      { data: [row("a"), row("b")], hasMore: true },
      { data: [row("c")], hasMore: false },
    ]);
    const res = await getVisitRequests("pending_approval");
    expect(res.source).toBe("api");
    expect(res.data.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
    expect(fetchJsonMock.mock.calls[0][0]).toContain("offset=0");
    expect(fetchJsonMock.mock.calls[1][0]).toContain("offset=500");
  });

  it("reports error rather than a silent truncation when a later page fails", async () => {
    servePages([{ data: [row("a")], hasMore: true }, "error"]);
    const res = await getVisitRequests();
    expect(res.source).toBe("error");
  });
});

describe("fetchVisitRequests pagination", () => {
  const okPage = (data: unknown[], hasMore: boolean) => ({
    ok: true,
    json: async () => ({ data, meta: { hasMore } }),
  });

  it("follows meta.hasMore across pages", async () => {
    browserFetchMock
      .mockResolvedValueOnce(okPage([row("a")], true))
      .mockResolvedValueOnce(okPage([row("b")], false));
    const out = await fetchVisitRequests("pending_approval");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(browserFetchMock.mock.calls[1][0]).toContain("offset=500");
  });

  it("throws when a page fails instead of returning a partial list", async () => {
    browserFetchMock
      .mockResolvedValueOnce(okPage([row("a")], true))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchVisitRequests("pending_approval")).rejects.toThrow();
  });
});
