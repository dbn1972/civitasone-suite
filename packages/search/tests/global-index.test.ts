import { describe, it, expect, vi } from "vitest";
import { GlobalSearchIndex, createTenantToken, buildGlobalDocument } from "../src/global/index.js";
import { createHmac, randomBytes } from "node:crypto";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeFetch(hits: Array<Record<string, unknown>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ hits, estimatedTotalHits: hits.length }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const hit = (tenantId: string, entityType: string, extra: Record<string, unknown> = {}) => ({
  tenantId, entityType, entityId: E1, title: "t", refNumber: "r", status: "s", summary: "", _rankingScore: 0.9, ...extra,
});

describe("GlobalSearchIndex.search: server-built filter", () => {
  it("filters by the caller's tenant and allowed types, nothing else", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    await idx.search({ tenantId: A, q: "bill", entityTypes: ["finance.bill", "finance.vendor"] });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.filter).toEqual([`tenantId = "${A}"`, `(entityType = "finance.bill" OR entityType = "finance.vendor")`]);
    expect(body.q).toBe("bill");
  });
  it("crafted q never reaches the filter (it is only the query field)", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    const evil = `x" OR tenantId = "${B}" OR "a"="a`;
    await idx.search({ tenantId: A, q: evil, entityTypes: ["finance.bill"] });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.q).toBe(evil);
    expect(JSON.stringify(body.filter)).not.toContain(B);
    expect(body.filter).toHaveLength(2);
  });
  it("refuses a tenant id that is not a UUID (filter-injection attempt) before any request", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    for (const bad of [`${A}" OR tenantId = "${B}`, "*", "", `${A}\\`, "abc"]) {
      await expect(idx.search({ tenantId: bad, q: "x", entityTypes: ["finance.bill"] })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });
  it("refuses an entity type outside the catalogue (filter-injection attempt)", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    await expect(idx.search({ tenantId: A, q: "x", entityTypes: [`finance.bill" OR tenantId = "${B}` as never] })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("no allowed types => no request, no hits (fail closed)", async () => {
    const { impl, calls } = fakeFetch([hit(A, "finance.bill")]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    expect(await idx.search({ tenantId: A, q: "x", entityTypes: [] })).toEqual({ hits: [], totalHits: 0 });
    expect(calls).toHaveLength(0);
  });
  it("drops a foreign-tenant hit and a hit of a type the caller may not see, even if the engine returned them", async () => {
    const { impl } = fakeFetch([hit(B, "finance.bill"), hit(A, "hrms.employee"), hit(A, "finance.bill"), hit(A, "bogus.type"), hit(A, "finance.bill", { entityId: "not-uuid" })]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    const r = await idx.search({ tenantId: A, q: "x", entityTypes: ["finance.bill"] });
    expect(r.hits.map((h) => `${h.entityType}`)).toEqual(["finance.bill"]);
    expect(r.hits[0]!.href).toBe(`/finance/expenditure/bills/${E1}`);
  });
  it("clamps limit and offset", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    await idx.search({ tenantId: A, q: "x", entityTypes: ["finance.bill"], limit: 100000, offset: -5 });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });
});

describe("tenant tokens", () => {
  const key = randomBytes(24).toString("hex");
  it("is an HS256 JWT whose rule pins the tenant and expires", () => {
    const tok = createTenantToken({ apiKey: key, apiKeyUid: "uid-1", tenantId: A, indexName: "global_search", expiresAtSec: 2_000_000_000 });
    const [h, p, s] = tok.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "HS256" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      apiKeyUid: "uid-1", searchRules: { global_search: { filter: `tenantId = "${A}"` } }, exp: 2_000_000_000,
    });
    expect(s).toBe(createHmac("sha256", key).update(`${h}.${p}`).digest("base64url"));
  });
  it("cannot be minted for a non-UUID tenant", () => {
    expect(() => createTenantToken({ apiKey: key, apiKeyUid: "u", tenantId: `${A}" OR 1=1`, indexName: "i", expiresAtSec: 1 })).toThrow();
  });
  it("search uses a per-tenant token (not the admin key) when a search key is configured", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "ADMIN", searchKey: key, searchKeyUid: "uid-1", fetchImpl: impl });
    await idx.search({ tenantId: A, q: "x", entityTypes: ["finance.bill"] });
    const auth = (calls[0]!.init.headers as Record<string, string>)["Authorization"]!;
    expect(auth).not.toContain("ADMIN");
    const payload = JSON.parse(Buffer.from(auth.replace("Bearer ", "").split(".")[1]!, "base64url").toString());
    expect(payload.searchRules.global_search.filter).toBe(`tenantId = "${A}"`);
  });
  it("remove() targets the tenant-embedded document id only", async () => {
    const { impl, calls } = fakeFetch([]);
    const idx = new GlobalSearchIndex({ host: "http://m", apiKey: "k", fetchImpl: impl });
    await idx.remove(A, "finance.bill", E1);
    expect(decodeURIComponent(calls[0]!.url)).toContain(buildGlobalDocument({ entityType: "finance.bill", entityId: E1, tenantId: A, title: "x", status: "s" }).doc.id);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
});
