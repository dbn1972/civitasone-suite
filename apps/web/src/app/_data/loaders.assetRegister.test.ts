import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("./apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apiClient")>()),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { getAssets, getFixedAssets, getAssetDashboard } from "./loaders";

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `a${from + i}`, name: `A${from + i}`, code: `C${from + i}`, acquisitionCost: "100" }));

// The loader's mapResponse is applied by fetchJson; emulate that so the paging logic sees AssetSummary rows.
function serve(total: number) {
  fetchJsonMock.mockImplementation(async (path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    const q = new URL(`http://x${path}`).searchParams;
    const limit = Number(q.get("limit"));
    const offset = Number(q.get("offset"));
    const page = rows(Math.max(0, Math.min(limit, total - offset)), offset);
    return { data: opts.mapResponse({ data: page }), source: "api" };
  });
}

// GAP-ASSETS-FIXED-ASSETS-02/06: the register must not silently stop at the service's default page.
describe("asset register paging", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("walks every 200-row page until a short page", async () => {
    serve(450);
    const res = await getAssets();
    expect(res.source).toBe("api");
    expect(res.data).toHaveLength(450);
    expect(fetchJsonMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/asset/assets?limit=200&offset=0",
      "/api/v1/asset/assets?limit=200&offset=200",
      "/api/v1/asset/assets?limit=200&offset=400",
    ]);
  });

  it("keeps the type filter on every page of the fixed register", async () => {
    serve(250);
    const res = await getFixedAssets();
    expect(res.data).toHaveLength(250);
    expect(fetchJsonMock.mock.calls.every((c) => String(c[0]).startsWith("/api/v1/asset/assets?type=fixed&limit=200"))).toBe(true);
  });

  it("a failed page fails the whole load rather than returning a partial register", async () => {
    fetchJsonMock
      .mockImplementationOnce(async (_p: string, _f: unknown, o: { mapResponse: (p: unknown) => unknown }) => ({ data: o.mapResponse({ data: rows(200) }), source: "api" }))
      .mockImplementationOnce(async () => ({ data: [], source: "error", status: 500 }));
    const res = await getAssets();
    expect(res.source).toBe("error");
    expect(res.data).toEqual([]);
  });
});

describe("asset register paging edge cases", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("does not stop early when the mapper drops a malformed row from a full page", async () => {
    fetchJsonMock.mockImplementation(async (path: string, _f: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
      const offset = Number(new URL(`http://x${path}`).searchParams.get("offset"));
      const page = offset === 0 ? [...rows(199), { id: "", name: "" }] : rows(10, 200); // 200 raw rows, one unmappable
      return { data: opts.mapResponse({ data: page }), source: "api" };
    });
    const res = await getAssets();
    expect(res.data).toHaveLength(209);
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("flags truncation when the 5,000-row cap is reached", async () => {
    fetchJsonMock.mockImplementation(async (path: string, _f: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
      const offset = Number(new URL(`http://x${path}`).searchParams.get("offset"));
      return { data: opts.mapResponse({ data: rows(200, offset) }), source: "api" };
    });
    const res = await getAssets();
    expect(res.truncated).toBe(true);
    expect(res.data).toHaveLength(5000);
    expect(fetchJsonMock).toHaveBeenCalledTimes(25);
  });

  it("is not truncated below the cap", async () => {
    serve(450);
    expect((await getAssets()).truncated).toBeUndefined();
  });
});

// GAP-ASSETS-DASHBOARD-03
describe("getAssetDashboard money mapping", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  async function mapped(payload: unknown) {
    fetchJsonMock.mockImplementation(async (_p: string, _f: unknown, o: { mapResponse: (p: unknown) => unknown }) => ({ data: o.mapResponse(payload), source: "api" }));
    return (await getAssetDashboard()).data;
  }

  it("keeps a bigint-safe digit string exactly", async () => {
    const d = await mapped({ totalAssets: 1, netBlock: "9000000000000001", recentGrnAssets: [{ id: "a", acquisitionCost: "9007199254740993" }] });
    expect(d.netBlock).toBe("9000000000000001");
    expect(d.recentGrnAssets?.[0]?.acquisitionCost).toBe("9007199254740993");
  });

  it("still accepts a plain number from an older payload", async () => {
    expect((await mapped({ netBlock: 12345 })).netBlock).toBe("12345");
  });

  it("maps a malformed value to null (rendered as —), never 0", async () => {
    const d = await mapped({ netBlock: "12.5", recentGrnAssets: [{ id: "a", acquisitionCost: "abc" }] });
    expect(d.netBlock).toBeNull();
    expect(d.recentGrnAssets?.[0]?.acquisitionCost).toBeNull();
  });
});
