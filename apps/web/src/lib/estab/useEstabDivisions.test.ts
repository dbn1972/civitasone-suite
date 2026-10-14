import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useEstabDivisions } from "./useEstabDivisions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("useEstabDivisions (GAP-ESTAB-FILES-NEW-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists each enrolled division once, sorted, ignoring blanks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [{ division: "Finance" }, { division: "ADMIN" }, { division: "Finance" }, { division: "" }, {}] }));
    const { result } = renderHook(() => useEstabDivisions());
    expect(result.current).toEqual({ loaded: false, failed: false, divisions: [] });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ loaded: true, failed: false, divisions: ["ADMIN", "Finance"] });
  });

  it("a failed response is reported as failed, not as 'no departments'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ message: "boom" }, 500));
    const { result } = renderHook(() => useEstabDivisions());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toEqual({ loaded: true, failed: true, divisions: [] });
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
