/**
 * Real-Meilisearch test (no mocks). Set MEILI_TEST_HOST to a THROWAWAY Meilisearch you started yourself,
 * e.g. `docker run -d --rm -p 127.0.0.1::7700 getmeili/meilisearch:v1.11.3`. Never point it at the live one.
 * Skipped when MEILI_TEST_HOST is not set.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { MeilisearchEngine } from "../src/meilisearch.js";
import type { SearchDocument } from "../src/types.js";

const HOST = process.env.MEILI_TEST_HOST;
const INDEX = `kd_untagged_${Date.now()}`;

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${HOST}/tasks?statuses=enqueued,processing&limit=1`);
    const j = (await r.json()) as { total?: number; results?: unknown[] };
    if (!(j.total ?? j.results?.length)) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("meilisearch tasks did not drain");
}

const doc = (id: string, tenantId: string, tags: string[], accessLevel?: string): SearchDocument => ({
  id, tenantId, documentId: `d-${id}`, title: "leave policy handbook", content: "annual leave policy", tags, ...(accessLevel ? { accessLevel } : {}),
});

// FLAKY-SKIP: needs a throwaway Meilisearch (MEILI_TEST_HOST); the CI Tests job has no Meilisearch service (expires: 2027-02-28)
describe.skipIf(!HOST)("Meilisearch untagged visibility (real engine)", () => {
  const eng = new MeilisearchEngine({ host: HOST });
  const ids = async (q: Parameters<MeilisearchEngine["search"]>[0]) => (await eng.search(q)).hits.map((h) => h.documentId).sort();

  beforeAll(async () => {
    await eng.initialize({ indexName: INDEX } as never);
    await drain();
    await eng.bulkIndex([
      doc("a1", "tenant-A", []),                 // untagged, A
      doc("a2", "tenant-A", ["finance"]),        // tagged finance, A
      doc("a3", "tenant-A", ["hrms"]),           // tagged hrms, A
      doc("b1", "tenant-B", []),                 // untagged, B
      doc("b2", "tenant-B", ["finance"]),        // tagged finance, B
      // tenant-D: clearance fixtures
      doc("p1", "tenant-D", [], "public"),
      doc("n1", "tenant-D", [], "internal"),
      doc("r1", "tenant-D", [], "restricted"),
      doc("c1", "tenant-D", [], "confidential"),
      doc("f1", "tenant-D", ["finance"], "confidential"), // tagged: module rule only, unchanged
    ]);
    // A document indexed with no `tags` attribute at all (legacy rows): must count as untagged too.
    await fetch(`${HOST}/indexes/${INDEX}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ id: "a4", tenantId: "tenant-A", documentId: "d-a4", title: "leave policy handbook", content: "annual leave policy", accessLevel: "internal" }]),
    });
    await fetch(`${HOST}/indexes/${INDEX}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ id: "x1", tenantId: "tenant-D", documentId: "d-x1", title: "leave policy handbook", content: "annual leave policy", accessLevel: "confidential" }]),
    });
    await drain();
  });

  it("without includeUntagged, untagged docs are hidden (today's behaviour)", async () => {
    expect(await ids({ q: "leave", tenantId: "tenant-A", tagsAny: ["finance"] })).toEqual(["d-a2"]);
  });

  it("with includeUntagged: module-matching tagged + all untagged of the SAME tenant; other modules stay hidden", async () => {
    expect(await ids({ q: "leave", tenantId: "tenant-A", tagsAny: ["finance"], includeUntagged: { accessLevels: null } })).toEqual(["d-a1", "d-a2", "d-a4"]);
  });

  it("no cross-tenant leak: tenant-A never sees tenant-B docs (tagged or untagged), and vice versa", async () => {
    const a = await ids({ q: "leave", tenantId: "tenant-A", tagsAny: ["finance", "hrms"], includeUntagged: { accessLevels: null } });
    expect(a).toEqual(["d-a1", "d-a2", "d-a3", "d-a4"]);
    expect(a.some((d) => d.startsWith("d-b"))).toBe(false);
    const b = await ids({ q: "leave", tenantId: "tenant-B", tagsAny: ["finance", "hrms"], includeUntagged: { accessLevels: null } });
    expect(b).toEqual(["d-b1", "d-b2"]);
  });

  it("a tenant with no documents sees nothing, even though untagged docs exist elsewhere", async () => {
    expect(await ids({ q: "leave", tenantId: "tenant-C", tagsAny: ["finance"], includeUntagged: { accessLevels: null } })).toEqual([]);
  });

  it("empty module list + includeUntagged: only untagged docs of that tenant", async () => {
    expect(await ids({ q: "leave", tenantId: "tenant-A", tagsAny: [], includeUntagged: { accessLevels: null } })).toEqual(["d-a1", "d-a4"]);
  });

  it("an injected tenant string cannot widen the filter", async () => {
    expect(await ids({ q: "leave", tenantId: 'tenant-A" OR tenantId = "tenant-B', tagsAny: ["finance"], includeUntagged: { accessLevels: null } })).toEqual([]);
  });

  const STD = { accessLevels: ["public", "internal"] };

  it("CLEARANCE: a normal user (public+internal) never gets an untagged restricted/confidential doc, including one with no tags field", async () => {
    const got = await ids({ q: "leave", tenantId: "tenant-D", tagsAny: ["finance"], includeUntagged: STD });
    expect(got).toEqual(["d-f1", "d-n1", "d-p1"]); // f1 is TAGGED finance: module rule only
    expect(got).not.toContain("d-r1");
    expect(got).not.toContain("d-c1");
    expect(got).not.toContain("d-x1");
  });

  it("CLEARANCE: an admin (null = every level) gets all untagged documents, restricted and confidential included", async () => {
    expect(await ids({ q: "leave", tenantId: "tenant-D", tagsAny: ["finance"], includeUntagged: { accessLevels: null } }))
      .toEqual(["d-c1", "d-f1", "d-n1", "d-p1", "d-r1", "d-x1"]);
  });

  it("CLEARANCE: an empty level list shows no untagged document at all", async () => {
    expect(await ids({ q: "leave", tenantId: "tenant-D", tagsAny: ["finance"], includeUntagged: { accessLevels: [] } })).toEqual(["d-f1"]);
  });

  it("CLEARANCE never crosses tenants: tenant-A's admin view contains no tenant-D document", async () => {
    const a = await ids({ q: "leave", tenantId: "tenant-A", tagsAny: ["finance"], includeUntagged: { accessLevels: null } });
    expect(a.some((d) => ["d-p1", "d-n1", "d-r1", "d-c1", "d-f1", "d-x1"].includes(d))).toBe(false);
  });
});
