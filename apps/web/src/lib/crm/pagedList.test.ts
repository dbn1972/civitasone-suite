import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dataOf, fetchRowsByIds, IDS_PER_REQUEST } from "./pagedList";

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

describe("dataOf", () => {
  it("reads the rows of a bare array, { data } and { items } envelope, and drops non-object entries", () => {
    expect(dataOf([{ id: "a" }, null, 3, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
    expect(dataOf({ data: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(dataOf({ items: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(dataOf({ rows: [{ id: "a" }] })).toEqual([]);
    expect(dataOf(null)).toEqual([]);
    expect(dataOf("x")).toEqual([]);
  });
});

describe("fetchRowsByIds", () => {
  it("asks for the ids in ONE request per 50, never paging by offset", async () => {
    const ids = Array.from({ length: IDS_PER_REQUEST + 1 }, (_, i) => `r${i}`);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const asked = new URL(String(input), "http://localhost").searchParams.get("ids")!.split(",");
      return res({ data: asked.map((id) => ({ id })) });
    });
    const r = await fetchRowsByIds("v1/crm/deals", ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(0).searchParams.get("ids")!.split(",")).toHaveLength(IDS_PER_REQUEST);
    expect(urlOf(1).searchParams.get("ids")).toBe(`r${IDS_PER_REQUEST}`);
    expect(urlOf(0).searchParams.has("offset")).toBe(false);
    expect(r.rows).toHaveLength(ids.length);
    expect(r.complete).toBe(true);
  });

  it("makes no request for nothing, and de-duplicates ids", async () => {
    expect(await fetchRowsByIds("v1/crm/deals", ["", ""])).toEqual({ rows: [], complete: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ data: [] }));
    await fetchRowsByIds("v1/crm/deals", ["d1", "d1"]);
    expect(urlOf(0).searchParams.get("ids")).toBe("d1");
  });

  it("reports an incomplete answer when a request fails, keeping the batches that arrived", async () => {
    const ids = Array.from({ length: IDS_PER_REQUEST + 1 }, (_, i) => `r${i}`);
    fetchMock.mockResolvedValueOnce(res({ data: [{ id: "r0" }] })).mockRejectedValueOnce(new Error("network"));
    const r = await fetchRowsByIds("v1/crm/accounts", ids);
    expect(r.rows).toEqual([{ id: "r0" }]);
    expect(r.complete).toBe(false);
  });
});
