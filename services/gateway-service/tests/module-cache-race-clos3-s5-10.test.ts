/**
 * CLOS3-S5-10: a getEnabled() load that started before invalidateModuleCache() must not
 * re-populate the cache (or lastKnownMode) afterwards, and concurrent callers at expiry
 * share one admin-service call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _test, invalidateModuleCache } from "../src/module-guard.js";

const T = "33333333-4444-4000-8000-000000000510";
const resp = (names: string[], mode = "enforce") =>
  new Response(JSON.stringify({ mode, data: names.map((name) => ({ name })) }), { status: 200 });

function deferred<R>() {
  let resolve!: (v: R) => void;
  const promise = new Promise<R>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("module-guard getEnabled vs invalidateModuleCache", () => {
  beforeEach(() => {
    _test.moduleCache.clear();
    _test.lastKnownMode.clear();
    process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();
    delete process.env.COMPOSITION_ENFORCEMENT;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a load in flight across an invalidation does not re-populate moduleCache/lastKnownMode with the old list", async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(resp(["finance", "hrms"]));
    vi.stubGlobal("fetch", fetchMock);

    const pending = _test.getEnabled(T);          // starts the pre-change fetch
    invalidateModuleCache(T);                      // admin changed modules
    first.resolve(resp(["finance"], "off"));       // late OLD answer
    const entry = await pending;

    // The requester got the fresh (post-invalidation) list, not the old one.
    expect(entry.modules).toEqual(new Set(["finance", "hrms"]));
    expect(_test.moduleCache.get(T)?.modules).toEqual(new Set(["finance", "hrms"]));
    expect(_test.lastKnownMode.get(T)).toBe("enforce");
  });

  it("with only the stale answer available, nothing stale is cached", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const pending = _test.getEnabled(T);
    invalidateModuleCache(T);
    first.resolve(resp(["finance"], "off"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); // retry against the new generation
    expect(_test.moduleCache.has(T)).toBe(false);
    expect(_test.lastKnownMode.has(T)).toBe(false);
    second.resolve(resp(["finance", "hrms"]));
    await pending;
  });

  it("concurrent callers at expiry make a single admin-service call", async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    vi.stubGlobal("fetch", fetchMock);
    const calls = [_test.getEnabled(T), _test.getEnabled(T), _test.getEnabled(T)];
    gate.resolve(resp(["finance"]));
    await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
