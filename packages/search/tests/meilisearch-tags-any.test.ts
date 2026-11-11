
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
});
