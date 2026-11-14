import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, USERS_PAGE_SIZE } from "./fetchAllPages";

const rowsOf = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

describe("fetchAllPages", () => {
  it("returns a single short page without asking for another", async () => {
    const f = vi.fn(async () => rowsOf(3));
    expect(await fetchAllPages(f)).toEqual({ rows: [0, 1, 2], complete: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(USERS_PAGE_SIZE, 0);
  });

  it("the 200/201 boundary: a full first page is followed by a second request that carries the 201st user", async () => {
    const f = vi.fn(async (_l: number, offset: number) => (offset === 0 ? rowsOf(200) : rowsOf(1, 200)));
    const res = await fetchAllPages(f);
    expect(res?.rows).toHaveLength(201);
    expect(res?.complete).toBe(true);
    expect(f.mock.calls.map((c) => c[1])).toEqual([0, 200]);
  });

  it("an exactly-full last page costs one extra (empty) request and still ends", async () => {
    const f = vi.fn(async (_l: number, offset: number) => (offset === 0 ? rowsOf(200) : []));
    expect(await fetchAllPages(f)).toMatchObject({ complete: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a failure on any page fails the whole walk (never a silently truncated list)", async () => {
    const f = vi.fn(async (_l: number, offset: number) => (offset === 0 ? rowsOf(200) : null));
    expect(await fetchAllPages(f)).toBeNull();
  });

  it("stops at the page cap and says the result is incomplete", async () => {
    const f = vi.fn(async () => rowsOf(200));
    const res = await fetchAllPages(f, 200, 3);
    expect(res).toMatchObject({ complete: false });
    expect(res?.rows).toHaveLength(600);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
