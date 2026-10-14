import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchWorkTypes, resolveWorkTypes } from "./workType";

// GAP-WORKS-PROPOSALS-NEW-01 acceptance: a failing fetch is an error, not "No matches".
describe("workType adapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("search() rejects on a non-ok response so the picker can show its error state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(searchWorkTypes("road", new AbortController().signal)).rejects.toThrow();
  });

  it("search() filters active work types by name/code on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "1", name: "Road", code: "RD", active: true },
            { id: "2", name: "Bridge", code: "BR", active: false },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await searchWorkTypes("r", new AbortController().signal);
    expect(out.map((o) => o.id)).toEqual(["1"]);
  });

  it("resolve() stays fail-soft (empty) on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(resolveWorkTypes(["1"])).resolves.toEqual([]);
  });
});
