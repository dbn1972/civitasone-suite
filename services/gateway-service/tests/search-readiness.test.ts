/**
 * Deploy-order hazard: the gateway filters on `kind` / `accessLevel`, which are only filterable once the index
 * settings were applied (engine.initialize(), which nothing runs at request time). On an older index that
 * meant `invalid_search_filter` -> 503 for ALL global search. The gateway now readies the index lazily
 * (memoised, failures retried), repairs + retries ONCE on invalid_search_filter, and NEVER sends the query
 * without its filters.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { setSearchEngine } from "../src/search-route.js";
import type { SearchEngine, SearchQuery } from "@civitasone/search";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "00000000-0000-4000-8000-000000000001";
const tok = (roles: string[]) => signToken({ sub: "00000000-0000-4000-8000-000000000099", tid: TENANT, roles, sid: "s" }, SECRET, 3600);

class FilterNotReady extends Error { readonly code = "invalid_search_filter"; }
const hit = { id: "u1", documentId: "u1", title: "t", content: "body", tags: [] as string[], score: 1 };

function engine(opts: { ensureReady?: () => Promise<void>; search: (q: SearchQuery) => Promise<unknown> }) {
  const queries: SearchQuery[] = [];
  const e = {
    initialize: vi.fn(), index: vi.fn(), bulkIndex: vi.fn(), remove: vi.fn(), removeAll: vi.fn(), close: vi.fn(), healthy: vi.fn(),
    ...(opts.ensureReady ? { ensureReady: vi.fn(opts.ensureReady) } : {}),
    search: vi.fn(async (q: SearchQuery) => { queries.push(q); return opts.search(q); }),
  } as unknown as SearchEngine & { ensureReady?: ReturnType<typeof vi.fn> };
  return { e, queries };
}
async function get(roles = ["finance_officer"]) {
  const app = await buildApp();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  const res = await app.inject({ method: "GET", url: "/api/v1/search?q=budget", headers: { authorization: `Bearer ${tok(roles)}` } });
  await app.close();
  vi.unstubAllGlobals();
  return res;
}
const ok = async () => ({ hits: [hit], totalHits: 1, processingTimeMs: 1 });

describe("lazy, memoised index readiness", () => {
  afterEach(() => setSearchEngine(null));

  it("readies the index once per process, before the first search, not on every search", async () => {
    const { e } = engine({ ensureReady: async () => undefined, search: ok });
    setSearchEngine(e);
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    expect(e.ensureReady).toHaveBeenCalledTimes(1);
    expect(e.search).toHaveBeenCalledTimes(3);
  });

  it("a failed readiness is NOT memoised: the next search tries again (and the search itself still runs, filtered)", async () => {
    let n = 0;
    const { e, queries } = engine({ ensureReady: async () => { if (++n === 1) throw new Error("meili down"); }, search: ok });
    setSearchEngine(e);
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    expect(e.ensureReady).toHaveBeenCalledTimes(2);
    expect(queries.every((q) => q.tenantId === TENANT && q.knowledgeAccessLevels !== undefined)).toBe(true);
  });

  it("invalid_search_filter: repairs the index once and retries ONCE with the SAME filtered query -> 200, not 503", async () => {
    let first = true;
    const { e, queries } = engine({
      ensureReady: async () => undefined,
      search: async () => { if (first) { first = false; throw new FilterNotReady("kind not filterable"); } return { hits: [hit], totalHits: 1, processingTimeMs: 1 }; },
    });
    setSearchEngine(e);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].id).toBe("u1");
    expect(e.search).toHaveBeenCalledTimes(2);
    expect(e.ensureReady).toHaveBeenCalledTimes(2); // lazy init + the repair
    expect(queries[1]).toEqual(queries[0]); // identical, filters intact
    expect(queries[1]!.knowledgeAccessLevels).toEqual(["public", "internal"]);
    expect(queries[1]!.includeUntagged).toEqual({ accessLevels: ["public", "internal"] });
  });

  it("concurrent invalid_search_filter results share ONE repair (a single settings PATCH), and each then retries once", async () => {
    let repaired = false;
    let calls = 0;
    const { e } = engine({
      ensureReady: async () => { calls++; if (calls > 1) { await new Promise((r) => setTimeout(r, 50)); repaired = true; } },
      search: async () => { if (!repaired) { await new Promise((r) => setTimeout(r, 10)); throw new FilterNotReady("x"); } return { hits: [hit], totalHits: 1, processingTimeMs: 1 }; },
    });
    setSearchEngine(e);
    const [a, b, c] = await Promise.all([get(), get(), get()]);
    expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([200, 200, 200]);
    expect(e.ensureReady).toHaveBeenCalledTimes(2); // the lazy init + exactly one shared repair
  });

  it("a persistent invalid_search_filter gives 503 after exactly one retry, and every attempt carried the clearance filters (never unfiltered)", async () => {
    const { e, queries } = engine({ ensureReady: async () => undefined, search: async () => { throw new FilterNotReady("still not filterable"); } });
    setSearchEngine(e);
    const res = await get();
    expect(res.statusCode).toBe(503);
    expect(e.search).toHaveBeenCalledTimes(2);
    for (const q of queries) {
      expect(q.knowledgeAccessLevels).toEqual(["public", "internal"]);
      expect(q.includeUntagged).toBeDefined();
      expect(q.tagsAny?.length).toBeGreaterThan(0);
    }
  });

  it("when the repair itself fails, no retry is made (503) and nothing unfiltered is sent", async () => {
    let n = 0;
    const { e } = engine({ ensureReady: async () => { if (++n > 1) throw new Error("settings rejected"); }, search: async () => { throw new FilterNotReady("x"); } });
    setSearchEngine(e);
    expect((await get()).statusCode).toBe(503);
    expect(e.search).toHaveBeenCalledTimes(1);
  });

  it("any other engine error is not retried", async () => {
    const { e } = engine({ ensureReady: async () => undefined, search: async () => { throw new Error("Meilisearch search failed: 500"); } });
    setSearchEngine(e);
    expect((await get()).statusCode).toBe(503);
    expect(e.search).toHaveBeenCalledTimes(1);
    expect(e.ensureReady).toHaveBeenCalledTimes(1);
  });

  it("an engine without ensureReady (OpenSearch) is searched directly", async () => {
    const { e } = engine({ search: ok });
    setSearchEngine(e);
    expect((await get()).statusCode).toBe(200);
  });
});
