/**
 * Real-Meilisearch deploy-order test: an index created BEFORE `kind` was filterable (legacy settings) must be
 * initialised by the gateway and then answer correctly instead of 503. Set MEILI_TEST_HOST to a throwaway
 * Meilisearch you started yourself; never the live one.
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MeilisearchEngine, SearchFilterError } from "@civitasone/search";
import { buildApp } from "../src/app.js";
import { setSearchEngine } from "../src/search-route.js";

const HOST = process.env.MEILI_TEST_HOST;
const INDEX = `legacy_idx_${Date.now()}`;
const TENANT = "00000000-0000-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET as string;
const tok = (roles: string[]) => signToken({ sub: "00000000-0000-4000-8000-000000000099", tid: TENANT, roles, sid: "s" }, SECRET, 3600);

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const j = (await (await fetch(`${HOST}/tasks?statuses=enqueued,processing&limit=1`)).json()) as { total?: number };
    if (!j.total) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const mk = (id: string, tags: string[], accessLevel: string, kind?: string) =>
  ({ id, tenantId: TENANT, documentId: id, title: "budget policy", content: "budget policy", tags, accessLevel, ...(kind ? { kind } : {}) });

// FLAKY-SKIP: needs a throwaway Meilisearch (MEILI_TEST_HOST); the CI Tests job has no Meilisearch service (expires: 2027-02-28)
describe.skipIf(!HOST)("gateway search on a legacy Meilisearch index (kind not filterable)", () => {
  beforeAll(async () => {
    // A legacy index: settings from before `kind` existed.
    await fetch(`${HOST}/indexes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uid: INDEX, primaryKey: "id" }) });
    await drain();
    await fetch(`${HOST}/indexes/${INDEX}/settings`, { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ filterableAttributes: ["tenantId", "category", "tags", "accessLevel"] }) });
    await drain();
    await fetch(`${HOST}/indexes/${INDEX}/documents`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify([
        mk("k-pub", [], "public", "knowledge"),
        mk("k-res-tagged", ["finance"], "restricted", "knowledge"),
        mk("m-fin", ["finance"], "confidential"),
      ]) });
    await drain();
  });
  afterEach(() => setSearchEngine(null));

  it("the hazard is real: without readiness the filtered search is refused with invalid_search_filter", async () => {
    const e = new MeilisearchEngine({ host: HOST, indexName: INDEX });
    await expect(e.search({ q: "budget", tenantId: TENANT, tagsAny: ["finance"], knowledgeAccessLevels: ["public", "internal"] })).rejects.toBeInstanceOf(SearchFilterError);
  });

  it("the gateway initialises the index lazily and answers correctly (200, clearance applied), not 503", async () => {
    setSearchEngine(new MeilisearchEngine({ host: HOST, indexName: INDEX }));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=budget", headers: { authorization: `Bearer ${tok(["finance_officer"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((d) => d.id).sort();
    expect(ids).toEqual(["k-pub", "m-fin"]); // the tagged RESTRICTED knowledge doc is not returned
  });

  it("knowledge_admin on the same (now repaired) index sees the restricted one too", async () => {
    setSearchEngine(new MeilisearchEngine({ host: HOST, indexName: INDEX }));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=budget", headers: { authorization: `Bearer ${tok(["knowledge_admin", "finance_officer"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Array<{ id: string }>).map((d) => d.id).sort()).toEqual(["k-pub", "k-res-tagged", "m-fin"]);
  });
});
