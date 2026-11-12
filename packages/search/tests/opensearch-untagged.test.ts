import { describe, it, expect, vi } from "vitest";
import { OpenSearchEngine } from "../src/opensearch.js";

async function bodyFor(q: Parameters<OpenSearchEngine["search"]>[0]) {
  const eng = new OpenSearchEngine({ node: "http://localhost:1" } as never);
  const search = vi.fn(async () => ({ body: { hits: { hits: [], total: { value: 0 } }, took: 1 } }));
  (eng as unknown as { client: unknown }).client = { search };
  await eng.search(q);
  return (search.mock.calls[0] as unknown as [{ body: { query: { bool: { must: unknown[]; filter: unknown[] } } } }])[0].body.query.bool;
}

describe("OpenSearch includeUntagged", () => {
  it("default: terms filter only", async () => {
    const b = await bodyFor({ q: "", tenantId: "t1", tagsAny: ["finance"] });
    expect(b.filter).toEqual([{ terms: { tags: ["finance"] } }]);
  });
  it("includeUntagged (standard clearance): untagged branch carries an accessLevel filter; tenant term still in must", async () => {
    const b = await bodyFor({ q: "", tenantId: "t1", tagsAny: ["finance"], includeUntagged: { accessLevels: ["public", "internal"] } });
    expect(b.must).toContainEqual({ term: { tenantId: "t1" } });
    expect(b.filter).toEqual([
      {
        bool: {
          should: [
            { terms: { tags: ["finance"] } },
            { bool: { must_not: [{ exists: { field: "tags" } }], filter: [{ terms: { accessLevel: ["public", "internal"] } }] } },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });
  it("cleared for every level (null): no accessLevel condition on the untagged branch", async () => {
    const b = await bodyFor({ q: "", tenantId: "t1", tagsAny: ["finance"], includeUntagged: { accessLevels: null } });
    expect(JSON.stringify(b.filter)).not.toContain("accessLevel");
  });
  it("an empty level list fails closed", async () => {
    const b = await bodyFor({ q: "", tenantId: "t1", tagsAny: ["finance"], includeUntagged: { accessLevels: [] } });
    expect(JSON.stringify(b.filter)).toContain('"accessLevel":["__none__"]');
  });
});
