import { describe, it, expect, vi, afterEach } from "vitest";
import { searchDivisions, resolveDivisions } from "./division";

// GAP-WORKS-REPORTS-01
describe("division entity adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("searches the server by name/code and labels name with code as sublabel", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "d1", name: "Nagpur PWD Division", code: "NGP-PWD", officeType: "division" }] }),
        { status: 200 },
      ),
    );
    const out = await searchDivisions("nagpur", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/works/masters/divisions/search?q=nagpur&limit=20");
    expect(out).toEqual([{ id: "d1", label: "Nagpur PWD Division", sublabel: "NGP-PWD" }]);
  });

  it("falls back to code then id for the label when name is blank", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "d2", name: "", code: "RRD-01" }] }), { status: 200 }),
    );
    expect(await searchDivisions("rrd", new AbortController().signal)).toEqual([{ id: "d2", label: "RRD-01" }]);
  });

  it("returns [] (not throw) on a failed search so the picker shows 'No matches'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(searchDivisions("x", new AbortController().signal)).resolves.toEqual([]);
  });

  it("resolves seeded ids to labels from the active list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "d1", name: "Nagpur PWD Division", code: "NGP-PWD" }, { id: "d2", name: "Rural Roads", code: "RRD" }] }),
        { status: 200 },
      ),
    );
    expect(await resolveDivisions(["d2"])).toEqual([{ id: "d2", label: "Rural Roads", sublabel: "RRD" }]);
  });

  it("resolve([]) short-circuits without a fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await resolveDivisions([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
