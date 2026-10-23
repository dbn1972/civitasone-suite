import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useEstabDivisions, type EstabDivisions } from "./useEstabDivisions";
import { deptFieldMode, type DeptFieldMode } from "./deptField";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("useEstabDivisions (GAP-ESTAB-FILES-NEW-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists each enrolled division once, sorted, ignoring blanks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [{ division: "Finance" }, { division: "ADMIN" }, { division: "Finance" }, { division: "" }, {}] }));
    const { result } = renderHook(() => useEstabDivisions());
    expect(result.current).toEqual({ loaded: false, failed: false, forbidden: false, divisions: [] });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ loaded: true, failed: false, forbidden: false, divisions: ["ADMIN", "Finance"] });
  });

  it("a failed response is reported as failed, not as 'no departments'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ message: "boom" }, 500));
    const { result } = renderHook(() => useEstabDivisions());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ loaded: true, failed: true, forbidden: false, divisions: [] });
  });

  it("a 403 is reported as forbidden: this role cannot read the directory, which is not an outage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ code: "FORBIDDEN" }, 403));
    const { result } = renderHook(() => useEstabDivisions());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ loaded: true, failed: true, forbidden: true, divisions: [] });
  });

  it("a network error is reported as failed", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    const { result } = renderHook(() => useEstabDivisions());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.divisions).toEqual([]);
  });

  it("accepts a bare array payload too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json([{ division: "Legal" }]));
    const { result } = renderHook(() => useEstabDivisions());
    await waitFor(() => expect(result.current.divisions).toEqual(["Legal"]));
  });
});

describe("deptFieldMode (GAP-ESTAB-FILES-NEW-03)", () => {
  const base: EstabDivisions = { loaded: true, failed: false, forbidden: false, divisions: [] };
  const cases: Array<[string, EstabDivisions, DeptFieldMode]> = [
    ["still loading", { ...base, loaded: false }, "loading"],
    ["divisions are enrolled", { ...base, divisions: ["ADMIN"] }, "pick"],
    ["a network or server error", { ...base, failed: true }, "blocked"],
    ["this role cannot read the directory (403)", { ...base, failed: true, forbidden: true }, "typed"],
    ["no operators are enrolled yet", base, "typed"],
  ];

  it.each(cases)("when %s -> %s", (_n, state, mode) => {
    expect(deptFieldMode(state)).toBe(mode);
  });

  it("a non-empty list always wins: a real master is never overridden by a failure flag", () => {
    // Only an EMPTY list plus a failure blocks.
    expect(deptFieldMode({ ...base, divisions: ["ADMIN"], failed: true })).toBe("pick");
  });
});
