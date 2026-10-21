import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAllPages, CRM_LIST_PAGE_SIZE } from "./pagedList";

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));
const offsets = () => fetchMock.mock.calls.map((c) => new URL(String(c[0]), "http://localhost").searchParams.get("offset"));

describe("fetchAllPages", () => {
  it("uses the server page size and walks offsets until the list is exhausted", async () => {
    fetchMock
      .mockResolvedValueOnce(res({ data: rows(CRM_LIST_PAGE_SIZE), meta: { total: 250 } }))
      .mockResolvedValueOnce(res({ data: rows(50, CRM_LIST_PAGE_SIZE), meta: { total: 250 } }));
    const r = await fetchAllPages({ path: "v1/crm/accounts" });
    expect(r.rows).toHaveLength(250);
    expect(r).toMatchObject({ complete: true, ok: true });
    expect(offsets()).toEqual(["0", "200"]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(`limit=${CRM_LIST_PAGE_SIZE}`);
  });

  it("stops at the reported total even when the last page is full", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: rows(CRM_LIST_PAGE_SIZE), pagination: { total: CRM_LIST_PAGE_SIZE } }));
    const r = await fetchAllPages({ path: "v1/crm/deals" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.complete).toBe(true);
  });

  it("stops as soon as `done` is satisfied", async () => {
    fetchMock.mockResolvedValue(res({ data: rows(CRM_LIST_PAGE_SIZE), meta: { total: 5000 } }));
    const r = await fetchAllPages({ path: "v1/crm/accounts", done: (read) => read.length >= CRM_LIST_PAGE_SIZE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.complete).toBe(true);
  });

  it("caps the number of pages and reports the result as incomplete", async () => {
    fetchMock.mockImplementation(async () => res({ data: rows(CRM_LIST_PAGE_SIZE) }));
    const r = await fetchAllPages({ path: "v1/crm/accounts", maxPages: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ complete: false, ok: true });
    expect(r.rows).toHaveLength(3 * CRM_LIST_PAGE_SIZE);
  });

  it("reports ok:false when not even the first page can be read, and keeps earlier pages when a later one fails", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "X" }, 500));
    expect(await fetchAllPages({ path: "v1/crm/accounts" })).toEqual({ rows: [], complete: false, ok: false });
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(res({ data: rows(CRM_LIST_PAGE_SIZE) })).mockRejectedValueOnce(new Error("network"));
    const partial = await fetchAllPages({ path: "v1/crm/accounts" });
    expect(partial).toMatchObject({ complete: false, ok: true });
    expect(partial.rows).toHaveLength(CRM_LIST_PAGE_SIZE);
  });
});
