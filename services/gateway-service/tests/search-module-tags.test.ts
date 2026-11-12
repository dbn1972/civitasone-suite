
import { describe, it, expect, vi, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { setSearchEngine, resolveUserModules } from "../src/search-route.js";
import type { SearchEngine, SearchQuery } from "@civitasone/search";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = "00000000-0000-4000-8000-000000000001";
const tok = (roles: string[]) => signToken({ sub: "00000000-0000-4000-8000-000000000099", tid: TENANT, roles, sid: "s" }, SECRET, 3600);

function engine() {
  const calls: SearchQuery[] = [];
  const e = {
    initialize: vi.fn(), index: vi.fn(), bulkIndex: vi.fn(), remove: vi.fn(), removeAll: vi.fn(), close: vi.fn(), healthy: vi.fn(),
    search: vi.fn(async (q: SearchQuery) => { calls.push(q); return { hits: [], totalHits: 0, processingTimeMs: 1 }; }),
  } as unknown as SearchEngine;
  return { e, calls };
}

describe("knowledge search module tags are OR-ed (not AND-ed)", () => {
  afterEach(() => setSearchEngine(null));
  const run = async (roles: string[]) => {
    const { e, calls } = engine();
    setSearchEngine(e);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=budget", headers: { authorization: `Bearer ${tok(roles)}` } });
    await app.close();
    vi.unstubAllGlobals();
    return { res, q: calls[0] };
  };

  it("single-module role: any-of that one module, never the AND filter", async () => {
    const { res, q } = await run(["finance_officer"]);
    expect(res.statusCode).toBe(200);
    expect(q?.tagsAny).toEqual(["finance"]);
    expect(q?.tags).toBeUndefined();
  });
  it("multi-module role: any-of all of its modules", async () => {
    const { q } = await run(["finance_officer", "hr_officer"]);
    expect([...(q?.tagsAny ?? [])].sort()).toEqual(["finance", "hrms", "payroll"]);
    expect(q?.tags).toBeUndefined();
  });
  it("admin: any-of every module, tenant still from the token", async () => {
    const { q } = await run(["super_admin"]);
    expect(q?.tagsAny).toEqual(resolveUserModules(["super_admin"]));
    expect(q?.tagsAny!.length).toBeGreaterThan(5);
    expect(q?.tags).toBeUndefined();
    expect(q?.tenantId).toBe(TENANT);
  });

  it("asks the engine to include untagged documents; the tenant still comes from the token", async () => {
    const { q } = await run(["finance_officer"]);
    expect(q?.includeUntagged).toBe(true);
    expect(q?.tenantId).toBe(TENANT);
  });
});

describe("untagged hits are returned as tenant-wide knowledge; tagged hits stay module-gated", () => {
  afterEach(() => setSearchEngine(null));
  const hit = (documentId: string, tags: string[]) => ({
    id: documentId, documentId, title: `t-${documentId}`, content: "plain text body", tags, score: 1, highlights: undefined,
  });
  it("keeps an untagged hit (module=knowledge), keeps a matching tagged hit, drops a tagged hit outside the user's modules", async () => {
    const e = {
      initialize: vi.fn(), index: vi.fn(), bulkIndex: vi.fn(), remove: vi.fn(), removeAll: vi.fn(), close: vi.fn(), healthy: vi.fn(),
      search: vi.fn(async () => ({ hits: [hit("u1", []), hit("f1", ["finance"]), hit("x1", ["payroll-secret-module"])], totalHits: 3, processingTimeMs: 1 })),
    } as unknown as SearchEngine;
    setSearchEngine(e);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=budget", headers: { authorization: `Bearer ${tok(["finance_officer"])}` } });
    await app.close();
    vi.unstubAllGlobals();
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string; module: string }>;
    expect(data.map((d) => [d.id, d.module])).toEqual([["u1", "knowledge"], ["f1", "finance"]]);
  });
});
