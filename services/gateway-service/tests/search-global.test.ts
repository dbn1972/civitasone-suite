/**
 * Cross-module search through the gateway: per-tenant flag (default off), tenant taken only from the verified JWT,
 * entity types taken only from the caller's roles, graceful degradation, and parity with today when the flag is off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { setSearchEngine, setGlobalSearchIndex } from "../src/search-route.js";
import type { GlobalSearchRequest, GlobalSearchResult as IndexResult, SearchEngine, GlobalEntityType } from "@civitasone/search";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ACTOR = "00000000-0000-4000-8000-000000000099";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const E2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const token = (roles: string[], tid: string) => signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET, 3600);

function knowledgeEngine(): SearchEngine {
  return {
    initialize: vi.fn(), index: vi.fn(), bulkIndex: vi.fn(), remove: vi.fn(), removeAll: vi.fn(), close: vi.fn(),
    healthy: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue({ hits: [], totalHits: 0, processingTimeMs: 1 }),
  } as unknown as SearchEngine;
}

/** In-memory index that applies the same tenant + type scoping the real one does, so the route's inputs decide the outcome. */
function memoryIndex() {
  const store = [
    { tenantId: A, entityType: "finance.vendor" as GlobalEntityType, entityId: E1, title: "Acme Traders", refNumber: "V-A", status: "active" },
    { tenantId: A, entityType: "hrms.employee" as GlobalEntityType, entityId: E1, title: "Acme Asha", refNumber: "EMP-A", status: "active" },
    { tenantId: B, entityType: "finance.vendor" as GlobalEntityType, entityId: E2, title: "Acme Traders", refNumber: "V-B", status: "active" },
  ];
  const calls: GlobalSearchRequest[] = [];
  return {
    calls,
    search: vi.fn(async (req: GlobalSearchRequest): Promise<IndexResult> => {
      calls.push(req);
      const hits = store
        .filter((d) => d.tenantId === req.tenantId && req.entityTypes.includes(d.entityType))
        .map((d) => ({ ...d, module: d.entityType.split(".")[0]!, summary: "", href: `/x/${d.entityId}` }));
      return { hits, totalHits: hits.length };
    }),
  };
}

const get = (app: Awaited<ReturnType<typeof buildApp>>, url: string, tok: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok}` } });

describe("GET /api/v1/search with cross-module records", () => {
  const saved = { ...process.env };
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    delete process.env.GLOBAL_SEARCH_TENANTS;
    delete process.env.GLOBAL_SEARCH_DISABLED;
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    setSearchEngine(knowledgeEngine());
    app = await buildApp();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    setSearchEngine(null);
    setGlobalSearchIndex(null);
    process.env = { ...saved };
    await app.close();
  });

  it("flag off (default): the cross-module index is never consulted and the response is the knowledge-only shape", async () => {
    const idx = memoryIndex();
    setGlobalSearchIndex(idx);
    const res = await get(app, "/api/v1/search?q=acme", token(["finance_officer"], A));
    expect(res.statusCode).toBe(200);
    expect(idx.search).not.toHaveBeenCalled();
    expect(res.json()).toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it("flag on for a different tenant: still off for this one", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = B;
    const idx = memoryIndex();
    setGlobalSearchIndex(idx);
    await get(app, "/api/v1/search?q=acme", token(["super_admin"], A));
    expect(idx.search).not.toHaveBeenCalled();
  });

  it("flag on: grouped records with type, label and record link, scoped to the caller's tenant and role", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    const idx = memoryIndex();
    setGlobalSearchIndex(idx);
    const res = await get(app, "/api/v1/search?q=acme", token(["finance_officer"], A));
    const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: E1, module: "finance", name: "Acme Traders", refNumber: "V-A", entityType: "finance.vendor", entityLabel: "Vendors", href: `/x/${E1}` });
    expect(body.meta.total).toBe(1);
    expect(idx.calls[0]!.tenantId).toBe(A);
    expect(idx.calls[0]!.entityTypes).toEqual(["finance.voucher", "finance.bill", "finance.vendor", "procurement.indent", "procurement.po"]); // finance_officer is a READER of indents/POs in procurement-service
  });

  it("tenant B never receives tenant A data, whatever the client puts in the query string", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = `${A},${B}`;
    const idx = memoryIndex();
    setGlobalSearchIndex(idx);
    const tokB = token(["super_admin"], B);
    const attempts = [
      `q=acme`,
      `q=acme&tenantId=${A}`,
      `q=acme&tid=${A}`,
      `q=${encodeURIComponent(`acme" OR tenantId = "${A}`)}`,
      `q=acme&filter=${encodeURIComponent(`tenantId = "${A}"`)}`,
      `q=acme&entityTypes=hrms.employee&types=hrms.employee`,
    ];
    for (const qs of attempts) {
      const res = await get(app, `/api/v1/search?${qs}`, tokB);
      expect(res.statusCode).toBe(200);
      const data = (res.json() as { data: Array<{ refNumber: string }> }).data;
      for (const d of data) expect(["V-B"]).toContain(d.refNumber);
    }
    for (const c of idx.calls) expect(c.tenantId).toBe(B);
  });

  it("an employee gets no cross-module record type: the index is not even asked", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    const idx = memoryIndex();
    setGlobalSearchIndex(idx);
    const res = await get(app, "/api/v1/search?q=acme", token(["employee"], A));
    expect(res.statusCode).toBe(200);
    expect(idx.search).not.toHaveBeenCalled();
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it("a role sees only its own record types (hr: employees, not vendors)", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    const idx = memoryIndex();
    setGlobalSearchIndex(idx);
    const res = await get(app, "/api/v1/search?q=acme", token(["hr_officer"], A));
    expect((res.json() as { data: Array<{ entityType: string }> }).data.map((d) => d.entityType)).toEqual(["hrms.employee"]);
  });

  it("cross-module index failure does not fail the request; it is flagged for the UI", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    setGlobalSearchIndex({ search: vi.fn().mockRejectedValue(new Error("engine down")) });
    const res = await get(app, "/api/v1/search?q=acme", token(["finance_officer"], A));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], meta: { recordsUnavailable: true } });
  });

  it("still requires authentication", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = A;
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=acme" });
    expect(res.statusCode).toBe(401);
  });
});
