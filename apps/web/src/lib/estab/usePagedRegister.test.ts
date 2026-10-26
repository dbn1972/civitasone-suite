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

  // CLOS3-S1-06: loadMore had no request token, so a slow reply for the OLD query appended stale rows
  // to the NEW results and overwrote the total.
  describe("loadMore vs query/reload changes (CLOS3-S1-06)", () => {
    async function mountWithFirstPage(pageSize = 2) {
      const held = installHeldFetch();
      const hook = renderHook(() => usePagedRegister<Row>("/api/x", pageSize));
      await flush();
      await act(async () => held.pending[0].resolve(rowsOf("a1", "a2"), 10));
      await flush();
      expect(hook.result.current.rows).toEqual(rowsOf("a1", "a2"));
      return { ...held, ...hook };
    }

    it("drops a late loadMore reply for the previous query", async () => {
      const { pending, result } = await mountWithFirstPage();
      let more!: Promise<void>;
      act(() => {
        more = result.current.loadMore();
      });
      await flush();
      expect(pending).toHaveLength(2);

      act(() => result.current.setSearchInput("zz"));
      await flush(400);
      expect(pending).toHaveLength(3);
      await act(async () => pending[2].resolve(rowsOf("z1"), 1));
      await flush();
      await act(async () => {
        pending[1].resolve(rowsOf("a3", "a4"), 10);
        await more;
      });
      await flush();

      expect(result.current.rows).toEqual(rowsOf("z1"));
      expect(result.current.total).toBe(1);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.loadingMore).toBe(false);
    });

    it("a plain loadMore still appends and de-duplicates", async () => {
      const { pending, result } = await mountWithFirstPage();
      let more!: Promise<void>;
      act(() => {
        more = result.current.loadMore();
      });
      await flush();
      await act(async () => {
        pending[1].resolve(rowsOf("a2", "a3"), 10);
        await more;
      });
      expect(result.current.rows).toEqual(rowsOf("a1", "a2", "a3"));
      expect(result.current.total).toBe(10);
      expect(result.current.loadingMore).toBe(false);
    });

    it("reload() during an in-flight loadMore keeps the reload result", async () => {
      const { pending, result } = await mountWithFirstPage();
      let more!: Promise<void>;
      let reloading!: Promise<void>;
      act(() => {
        more = result.current.loadMore();
      });
      await flush();
      act(() => {
        reloading = result.current.reload();
      });
      await flush();
      expect(pending).toHaveLength(3);
      await act(async () => {
        pending[2].resolve(rowsOf("r1"), 1);
        await reloading;
      });
      await act(async () => {
        pending[1].resolve(rowsOf("a3", "a4"), 10);
        await more;
      });
      await flush();
      expect(result.current.rows).toEqual(rowsOf("r1"));
      expect(result.current.total).toBe(1);
      expect(result.current.loading).toBe(false);
      expect(result.current.loadingMore).toBe(false);
    });

    it("a loadMore failure on the current query sets moreError", async () => {
      const { pending, result } = await mountWithFirstPage();
      let more!: Promise<void>;
      act(() => {
        more = result.current.loadMore();
      });
      await flush();
      const err = new Error("page 2 down");
      await act(async () => {
        pending[1].fail(err);
        await more;
      });
      expect(result.current.moreError).toBe(err);
      expect(result.current.rows).toEqual(rowsOf("a1", "a2"));
      expect(result.current.loadingMore).toBe(false);
    });

    it("a loadMore failure for a stale query is ignored", async () => {
      const { pending, result } = await mountWithFirstPage();
      let more!: Promise<void>;
      act(() => {
        more = result.current.loadMore();
      });
      await flush();
      act(() => result.current.setSearchInput("zz"));
      await flush(400);
      await act(async () => pending[2].resolve(rowsOf("z1"), 1));
      await flush();
      await act(async () => {
        pending[1].fail(new Error("old query page 2 down"));
        await more;
      });
      expect(result.current.moreError).toBeNull();
      expect(result.current.rows).toEqual(rowsOf("z1"));
    });
  });
});
