
import { describe, it, expect, vi } from "vitest";
import { MeilisearchEngine } from "../src/meilisearch.js";

function filterFor(q: Parameters<MeilisearchEngine["search"]>[0]) {
  const calls: Array<{ filter: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ hits: [] }), { status: 200 }); }));
  return new MeilisearchEngine({ host: "http://m", apiKey: "k" }).search(q).then(() => { vi.unstubAllGlobals(); return calls[0]!.filter as string[]; });
}

describe("tagsAny (OR) filter", () => {
  it("ORs the tags inside one clause, next to the tenant clause", async () => {
    expect(await filterFor({ q: "x", tenantId: "t1", tagsAny: ["finance", "hrms"] })).toEqual(['tenantId = "t1"', '(tags = "finance" OR tags = "hrms")']);
  });
  it("tags stays AND, and the two combine", async () => {
    const f = await filterFor({ q: "x", tenantId: "t1", tags: ["a", "b"], tagsAny: ["finance"] });
    expect(f).toContain('tags = "a" AND tags = "b"');
    expect(f).toContain('(tags = "finance")');
  });
  it("empty list matches nothing; quotes cannot break out", async () => {
    expect(await filterFor({ q: "x", tenantId: "t1", tagsAny: [] })).toContain('tags = "__none__"');
    const f = await filterFor({ q: "x", tenantId: "t1", tagsAny: ['a" OR tenantId = "t2'] });
    expect(f.join()).not.toContain('"t2');
  });
  it("no tagsAny: filter unchanged", async () => {
    expect(await filterFor({ q: "x", tenantId: "t1" })).toEqual(['tenantId = "t1"']);
  });
  const STD = { accessLevels: ["public", "internal"] };
  it("includeUntagged: untagged branch is limited to the caller's clearance, INSIDE the tagsAny clause; tenant stays a separate AND element", async () => {
    const f = await filterFor({ q: "x", tenantId: "t1", tagsAny: ["finance", "hrms"], includeUntagged: STD });
    expect(f).toEqual([
      'tenantId = "t1"',
      '(tags = "finance" OR tags = "hrms" OR (tags IS EMPTY AND (accessLevel = "public" OR accessLevel = "internal")) OR (tags NOT EXISTS AND (accessLevel = "public" OR accessLevel = "internal")))',
    ]);
  });
  it("includeUntagged with accessLevels null (cleared for every level) adds no level condition", async () => {
    const f = await filterFor({ q: "x", tenantId: "t1", tagsAny: ["finance"], includeUntagged: { accessLevels: null } });
    expect(f).toEqual(['tenantId = "t1"', '(tags = "finance" OR (tags IS EMPTY) OR (tags NOT EXISTS))']);
  });
  it("includeUntagged with an EMPTY level list fails closed (matches no untagged document)", async () => {
    const f = await filterFor({ q: "x", tenantId: "t1", tagsAny: ["finance"], includeUntagged: { accessLevels: [] } });
    expect(f[1]).toContain('accessLevel = "__none__"');
    expect(f[1]).not.toContain('accessLevel = "public"');
  });
  it("a level string cannot break out of the filter", async () => {
    const f = await filterFor({ q: "x", tenantId: "t1", tagsAny: ["finance"], includeUntagged: { accessLevels: ['internal" OR tenantId = "t2'] } });
    expect(f.join()).not.toContain('"t2');
  });
  it("includeUntagged with an empty module list still shows only untagged documents of the tenant, within clearance", async () => {
    const f = await filterFor({ q: "x", tenantId: "t1", tagsAny: [], includeUntagged: STD });
    expect(f[0]).toBe('tenantId = "t1"');
    expect(f[1]).toMatch(/^\(\(tags IS EMPTY AND /);
  });
  it("includeUntagged without tagsAny changes nothing", async () => {
    expect(await filterFor({ q: "x", tenantId: "t1", includeUntagged: STD })).toEqual(['tenantId = "t1"']);
  });
});
