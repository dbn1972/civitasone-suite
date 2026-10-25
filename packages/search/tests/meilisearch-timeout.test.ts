/**
 * CLOS3-S6-14: Meilisearch HTTP calls must be time-bounded. A host that
 * accepts the connection but never answers used to hang every engine call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeilisearchEngine } from "../src/index.js";

/** fetch that never settles unless its signal aborts (like a hung socket). */
function hangingFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (!signal) return; // pre-fix behaviour: pending forever
        signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
      }),
  );
}

describe("MeilisearchEngine request timeout (CLOS3-S6-14)", () => {
  beforeEach(() => {
    process.env.MEILISEARCH_TIMEOUT_MS = "50";
    process.env.MEILISEARCH_BULK_TIMEOUT_MS = "120";
  });
  afterEach(() => {
    delete process.env.MEILISEARCH_TIMEOUT_MS;
    delete process.env.MEILISEARCH_BULK_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  const race = <T,>(p: Promise<T>) =>
    Promise.race([p.then(() => "settled", () => "rejected"), new Promise<string>((r) => setTimeout(() => r("HUNG"), 1000))]);

  it("search() rejects instead of hanging", async () => {
    hangingFetch();
    const e = new MeilisearchEngine({ host: "http://x", apiKey: "k" });
    expect(await race(e.search({ query: "q", tenantId: "t" } as never))).toBe("rejected");
  });

  it("healthy() returns false instead of hanging", async () => {
    hangingFetch();
    const e = new MeilisearchEngine({ host: "http://x" });
    await expect(Promise.race([e.healthy(), new Promise((r) => setTimeout(() => r("HUNG"), 1000))])).resolves.toBe(false);
  });

  it("remove() rejects instead of hanging", async () => {
    hangingFetch();
    const e = new MeilisearchEngine({ host: "http://x" });
    expect(await race(e.remove("id", "t"))).toBe("rejected");
  });

  it("bulk calls use the longer bulk timeout", async () => {
    const spy = hangingFetch();
    const e = new MeilisearchEngine({ host: "http://x" });
    const t0 = Date.now();
    expect(await race(e.removeAll("t"))).toBe("rejected");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a caller-supplied signal is respected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const e = new MeilisearchEngine({ host: "http://x" }) as unknown as {
      fetch: (p: string, i: RequestInit) => Promise<Response>;
    };
    const own = new AbortController();
    await e.fetch("/health", { method: "GET", signal: own.signal });
    expect((spy.mock.calls[0]![1] as RequestInit).signal).toBe(own.signal);
  });

  it("a normal fast response is unaffected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await new MeilisearchEngine({ host: "http://x" }).healthy()).toBe(true);
  });
});
