import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { errorMessageFromResponse } from "@/lib/api/browserClient";
import { ACCOUNT_IDS_PER_REQUEST, fetchAccountsByIds, searchAccountsByName } from "./accountLookup";

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urlOf = (i: number) => new URL(String(fetchMock.mock.calls[i]![0]), "http://localhost");

describe("fetchAccountsByIds", () => {
  it("looks the accounts up in ONE request by id, never by paging the list", async () => {
    fetchMock.mockResolvedValue(res({ data: [{ id: "a1", name: "Acme Corp" }], meta: { total: 1 } }));
    const r = await fetchAccountsByIds(["a1", "a2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(0).pathname).toMatch(/\/v1\/crm\/accounts$/);
    expect(urlOf(0).searchParams.get("ids")).toBe("a1,a2");
    expect(urlOf(0).searchParams.get("limit")).toBe("50");
    expect(urlOf(0).searchParams.has("offset")).toBe(false);
    expect(r.rows).toEqual([{ id: "a1", name: "Acme Corp" }]);
    // a2 was not returned: the answer was definitive (inactive or missing), so it is complete
    expect(r.complete).toBe(true);
  });

  it("splits more than 50 ids into batches of 50 and merges the answers", async () => {
    const ids = Array.from({ length: ACCOUNT_IDS_PER_REQUEST + 5 }, (_, i) => `a${i}`);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const asked = new URL(String(input), "http://localhost").searchParams.get("ids")!.split(",");
      return res({ data: asked.map((id) => ({ id, name: `Name ${id}` })) });
    });
    const r = await fetchAccountsByIds(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(0).searchParams.get("ids")!.split(",")).toHaveLength(ACCOUNT_IDS_PER_REQUEST);
    expect(urlOf(1).searchParams.get("ids")!.split(",")).toHaveLength(5);
    expect(r.rows).toHaveLength(ids.length);
    expect(r.complete).toBe(true);
  });

  it("de-duplicates ids, ignores blanks and makes no request for nothing", async () => {
    expect(await fetchAccountsByIds([])).toEqual({ rows: [], complete: true });
    expect(await fetchAccountsByIds(["", ""])).toEqual({ rows: [], complete: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ data: [] }));
    await fetchAccountsByIds(["a1", "a1"]);
    expect(urlOf(0).searchParams.get("ids")).toBe("a1");
  });

  it("reports an incomplete answer (not a final 'not found') when a request fails", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect(await fetchAccountsByIds(["a1"])).toEqual({ rows: [], complete: false });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await fetchAccountsByIds(["a1"])).toEqual({ rows: [], complete: false });
  });

  it("keeps the batches that did arrive when a later one fails", async () => {
    const ids = Array.from({ length: ACCOUNT_IDS_PER_REQUEST + 1 }, (_, i) => `a${i}`);
    fetchMock
      .mockResolvedValueOnce(res({ data: [{ id: "a0", name: "First" }] }))
      .mockResolvedValueOnce(res({}, 503));
    const r = await fetchAccountsByIds(ids);
    expect(r.rows).toEqual([{ id: "a0", name: "First" }]);
    expect(r.complete).toBe(false);
  });
});

describe("searchAccountsByName", () => {
  it("sends the trimmed text as the server-side search with a small page", async () => {
    fetchMock.mockResolvedValue(res({ data: [{ id: "a1", name: "Acme Corp" }] }));
    const rows = await searchAccountsByName("  acme  ", 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(0).searchParams.get("search")).toBe("acme");
    expect(urlOf(0).searchParams.get("limit")).toBe("20");
    expect(rows).toEqual([{ id: "a1", name: "Acme Corp" }]);
  });

  it("sends no search param for a blank query", async () => {
    fetchMock.mockResolvedValue(res({ data: [] }));
    await searchAccountsByName("   ", 20);
    expect(urlOf(0).searchParams.has("search")).toBe(false);
  });

  it("encodes characters that are special in a query string", async () => {
    fetchMock.mockResolvedValue(res({ data: [] }));
    await searchAccountsByName("R&D 50%", 20);
    expect(urlOf(0).searchParams.get("search")).toBe("R&D 50%");
  });

  it("throws on a failed request so the caller can tell it from 'no matches'", async () => {
    fetchMock.mockImplementation(async () => res({}, 500));
    await expect(searchAccountsByName("acme", 20)).rejects.toThrow();
  });

  // A clerk reads this message: it must be the app's plain-language one for a 500, never a
  // status code ("accounts search failed (500)"). Without this a revert to a raw-status Error
  // would stay green here and only be caught by the repo-wide raw-status-leak CI guard.
  it("fails with the plain-language message for the status, never a raw HTTP status", async () => {
    fetchMock.mockImplementation(async () => res({}, 500));
    const expected = await errorMessageFromResponse(res({}, 500));
    expect(expected).not.toMatch(/\b500\b/);
    await expect(searchAccountsByName("acme", 20)).rejects.toThrow(expected);
    await expect(searchAccountsByName("acme", 20)).rejects.not.toThrow(/\b500\b/);
  });
});
