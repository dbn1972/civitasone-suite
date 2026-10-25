import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePagedRegister } from "./usePagedRegister";

type Row = { id: string };
type Pending = {
  url: string;
  resolve: (rows: Row[], total: number) => void;
  fail: (e: unknown) => void;
};

/** fetch stub whose requests stay open until resolved; an abort rejects with AbortError. */
function installHeldFetch() {
  const pending: Pending[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const abortErr = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
      init?.signal?.addEventListener("abort", () => reject(abortErr()));
      pending.push({
        url: String(input),
        resolve: (rows, total) =>
          resolve(new Response(JSON.stringify({ data: rows, pagination: { total } }), { status: 200 })),
        fail: reject,
      });
    }),
  );
  vi.stubGlobal("fetch", fn);
  return { fn, pending };
}

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const rowsOf = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("usePagedRegister", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // CLOS3-S1-07: the aborted load's finally{} cleared the loading flag the newer load had just set.
  it("keeps loading true while a superseded search request is pending, then settles", async () => {
    const { fn, pending } = installHeldFetch();
    const { result } = renderHook(() => usePagedRegister<Row>("/api/x", 50));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => result.current.setSearchInput("abc"));
    await flush(400);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(true);

    await act(async () => pending[1].resolve(rowsOf("n1"), 1));
    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toEqual(rowsOf("n1"));
  });

  it("goes loading true -> false on a normal single load", async () => {
    const { pending } = installHeldFetch();
    const { result } = renderHook(() => usePagedRegister<Row>("/api/x", 50));
    await flush();
    expect(result.current.loading).toBe(true);
    await act(async () => pending[0].resolve(rowsOf("a1"), 1));
    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.failed).toBe(false);
  });

  it("a failed first page sets failed and clears loading", async () => {
    const { pending } = installHeldFetch();
    const { result } = renderHook(() => usePagedRegister<Row>("/api/x", 50));
    await flush();
    await act(async () => pending[0].fail(new Error("boom")));
    await flush();
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("a non-abort failure of the newer request after a supersede still ends loading=false", async () => {
    const { pending } = installHeldFetch();
    const { result } = renderHook(() => usePagedRegister<Row>("/api/x", 50));
    await flush();
    act(() => result.current.setSearchInput("abc"));
    await flush(400);
    await act(async () => pending[1].fail(new Error("boom")));
    await flush();
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
  });
});
