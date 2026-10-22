import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchDesignations, resolveDesignations } from "./designation";

describe("entityAdapters/designation", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = () =>
    new Response(JSON.stringify({ data: [{ id: "d1", name: "Section Officer", grade: "7" }, { id: "d2", name: "Under Secretary" }] }), { status: 200 });

  it("filters the tenant's designation list client-side and maps to {id,label,sublabel}", async () => {
    fetchMock.mockResolvedValue(ok());
    const result = await searchDesignations("under", new AbortController().signal);
    expect(result).toEqual([{ id: "d2", label: "Under Secretary", sublabel: undefined }]);
  });

  it("degrades a non-ok response to an empty list by default (existing callers unchanged)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await searchDesignations("x", new AbortController().signal)).toEqual([]);
  });

  // GAP-HR-PROMOTION-05: a failed list must not read as "No matches".
  it("throws on a non-ok response in strict mode, so EntityPicker shows 'could not load' instead", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await expect(searchDesignations("x", new AbortController().signal, { strict: true })).rejects.toThrow();
  });

  it("strict mode still returns results when the list loads", async () => {
    fetchMock.mockResolvedValue(ok());
    expect((await searchDesignations("", new AbortController().signal, { strict: true })).map((o) => o.id)).toEqual(["d1", "d2"]);
  });

  it("resolveDesignations stays lenient", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await resolveDesignations(["d1"])).toEqual([]);
  });
});
