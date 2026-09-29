import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchPayStructures, resolvePayStructures } from "./payStructure";

describe("entityAdapters/payStructure", () => {
  const fetchMock = vi.fn();
  const ROWS = [
    { id: "p1", name: "Level 10 Standard", code: "L10-STD" },
    { id: "p2", name: "Level 12 Standard", code: "L12-STD" },
  ];
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: ROWS }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searchPayStructures fetches the existing structures list once and filters client-side by name or code", async () => {
    const result = await searchPayStructures("l12", new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/payroll/structures?limit=200",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual([{ id: "p2", label: "Level 12 Standard", sublabel: "L12-STD" }]);
  });

  it("searchPayStructures returns every row when the query is empty", async () => {
    const result = await searchPayStructures("", new AbortController().signal);
    expect(result).toHaveLength(2);
  });

  it("resolvePayStructures returns only the rows matching the given ids", async () => {
    const result = await resolvePayStructures(["p2"]);
    expect(result).toEqual([{ id: "p2", label: "Level 12 Standard", sublabel: "L12-STD" }]);
  });

  it("resolvePayStructures short-circuits to an empty list without calling fetch for an empty id list", async () => {
    const result = await resolvePayStructures([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
