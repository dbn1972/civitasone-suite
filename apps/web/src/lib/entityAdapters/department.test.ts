import { describe, it, expect, vi, afterEach } from "vitest";
import { searchDepartments, resolveDepartments } from "./department";

// GAP-PROCUREMENT-PLANNING-NEW-02
describe("department entity adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches the hrms department list and filters by name/code client-side", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "d1", name: "Finance Department", code: "FIN" },
            { id: "d2", name: "Public Works", code: "PWD" },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await searchDepartments("fin", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/hrms/departments");
    expect(out).toEqual([{ id: "d1", label: "Finance Department", sublabel: "FIN" }]);
  });

  it("returns the whole list for an empty query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "d1", name: "Finance", code: "FIN" }] }), { status: 200 }),
    );
    expect(await searchDepartments("", new AbortController().signal)).toHaveLength(1);
  });

  it("returns [] (not throw) on a failed fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(searchDepartments("x", new AbortController().signal)).resolves.toEqual([]);
  });

  it("resolves seeded ids to canonical name labels", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "d1", name: "Finance", code: "FIN" }, { id: "d2", name: "PWD Dept", code: "PWD" }] }),
        { status: 200 },
      ),
    );
    expect(await resolveDepartments(["d2"])).toEqual([{ id: "d2", label: "PWD Dept", sublabel: "PWD" }]);
  });

  it("resolve([]) short-circuits without a fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await resolveDepartments([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
