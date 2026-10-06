import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// useSeededResource's cache fallback goes through these two functions. jsdom
// has no real IndexedDB, so the un-mocked implementation would already no-op
// to `null` — mock explicitly so we can exercise both the cache-hit and
// cache-miss branches deterministically.
vi.mock("./responseCache", () => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

import { readCache, writeCache } from "./responseCache";
import { useSeededResource } from "./resource";

const mockedReadCache = vi.mocked(readCache);
const mockedWriteCache = vi.mocked(writeCache);

describe("useSeededResource — UX-002 dataProvenance is the single source of truth", () => {
  beforeEach(() => {
    mockedReadCache.mockReset();
    mockedWriteCache.mockReset();
    mockedWriteCache.mockResolvedValue(undefined);
  });

  it("reports provenance='live' for fresh, non-empty server data", async () => {
    const { result } = renderHook(() =>
      useSeededResource("k.live", [{ id: 1 }], "api", (d: unknown[]) => d.length === 0),
    );
    await waitFor(() => expect(result.current.provenance).toBe("live"));
    expect(result.current.fromCache).toBe(false);
    expect(mockedWriteCache).toHaveBeenCalledWith("k.live", [{ id: 1 }]);
  });

  it("reports provenance='live' for a legitimately empty server result (not an error)", async () => {
    mockedReadCache.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useSeededResource("k.empty", [] as unknown[], "api", (d: unknown[]) => d.length === 0),
    );
    // GAP-PROCUREMENT-EMD-BG-04: a legitimately empty "api" result is now
    // authoritative-live — the hook renders it and OVERWRITES the cache rather
    // than reading a stale copy. (It no longer calls readCache at all for a
    // successful server read.)
    await waitFor(() => expect(mockedWriteCache).toHaveBeenCalledWith("k.empty", []));
    expect(result.current.provenance).toBe("live");
    expect(result.current.data).toEqual([]);
    expect(mockedReadCache).not.toHaveBeenCalled();
  });

  // This is the exact case the gap (UX-002) is about: the server call failed,
  // but a usable cached copy exists. Provenance must resolve to "cached" —
  // one honest, unambiguous state — not leave callers to separately re-derive
  // "did this come from cache" from `source`/`fromCache` on their own.
  it("reports provenance='cached' and serves cached data when the server failed but a cache exists", async () => {
    mockedReadCache.mockResolvedValue({ value: [{ id: 99 }], cachedAt: "2026-09-01T00:00:00.000Z" });
    const { result } = renderHook(() =>
      useSeededResource("k.cached", [] as unknown[], "error", (d: unknown[]) => d.length === 0),
    );
    await waitFor(() => expect(result.current.provenance).toBe("cached"));
    expect(result.current.fromCache).toBe(true);
    expect(result.current.cachedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.current.data).toEqual([{ id: 99 }]);
  });

  it("reports provenance='error-no-data' when the server failed and there is no usable cache", async () => {
    mockedReadCache.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useSeededResource("k.nodata", [] as unknown[], "error", (d: unknown[]) => d.length === 0),
    );
    await waitFor(() => expect(result.current.provenance).toBe("error-no-data"));
    expect(result.current.fromCache).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("reports provenance='error-no-data' when the server failed and the only cache entry is itself empty", async () => {
    mockedReadCache.mockResolvedValue({ value: [] as unknown[], cachedAt: "2026-09-01T00:00:00.000Z" });
    const { result } = renderHook(() =>
      useSeededResource("k.emptycache", [] as unknown[], "error", (d: unknown[]) => d.length === 0),
    );
    await waitFor(() => expect(result.current.provenance).toBe("error-no-data"));
    expect(result.current.fromCache).toBe(false);
  });

  // GAP-PROCUREMENT-EMD-BG-04 / GAP-PROCUREMENT-GEM-05: a successful but EMPTY
  // api result is authoritative — it must NOT be replaced by stale cached
  // rows, and it must overwrite the cache so those rows can't resurface. On
  // the old code (`serverUsable = serverSource==='api' && !isEmpty(initialData)`)
  // an empty api response fell through to the cache and showed [{id:1}].
  it("renders an authoritative empty api result as live, ignoring and overwriting cached rows", async () => {
    mockedReadCache.mockResolvedValue({ value: [{ id: 1 }], cachedAt: "2026-09-01T00:00:00.000Z" });
    const { result } = renderHook(() =>
      useSeededResource("k.apiempty", [] as unknown[], "api", (d: unknown[]) => d.length === 0),
    );
    await waitFor(() => expect(result.current.provenance).toBe("live"));
    expect(result.current.data).toEqual([]);
    expect(result.current.fromCache).toBe(false);
    // Cache is overwritten with the empty authoritative result.
    expect(mockedWriteCache).toHaveBeenCalledWith("k.apiempty", []);
    // The stale cached rows are never read into state.
    expect(result.current.data).not.toEqual([{ id: 1 }]);
  });
});
