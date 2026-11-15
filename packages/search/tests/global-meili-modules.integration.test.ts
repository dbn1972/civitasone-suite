/** Real-engine isolation / permission check for the second batch of types. Same env gate as global-meili.integration.test.ts. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { GlobalSearchIndex, buildGlobalDocument, entityTypesForRoles, type GlobalEntityType } from "../src/global/index.js";

const URL_ = process.env.GLOBAL_SEARCH_TEST_MEILI_URL;
const MASTER = process.env.GLOBAL_SEARCH_TEST_MEILI_KEY ?? "";
const run = URL_ ? describe : describe.skip;

run("global search, contracts / meetings / files / applications, real Meilisearch", () => {
  const indexName = `gs_test2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const A = randomUUID();
  const B = randomUUID();
  let idx: GlobalSearchIndex;
  const mk = (tenantId: string, entityType: GlobalEntityType, title: string, ref: string) =>
    buildGlobalDocument({ entityType, entityId: randomUUID(), tenantId, title, refNumber: ref, status: "active" }).doc;

  beforeAll(async () => {
    idx = new GlobalSearchIndex({ host: URL_, apiKey: MASTER, indexName });
    await idx.waitForTask(await idx.initialize());
    await idx.waitForTask(await idx.upsert([
      mk(A, "contracts.contract", "Road works Zeta", "CON-A"), mk(B, "contracts.contract", "Road works Zeta", "CON-B"),
      mk(A, "meeting.meeting", "Zeta review", "MTG-A"), mk(B, "meeting.meeting", "Zeta review", "MTG-B"),
      mk(A, "estab.file", "Zeta policy", "F-A"), mk(B, "estab.file", "Zeta policy", "F-B"),
      mk(A, "citizen.application", "Application APP-A", "APP-A"), mk(B, "citizen.application", "Application APP-B", "APP-B"),
    ]));
  }, 60_000);
  afterAll(async () => { if (URL_) await fetch(`${URL_}/indexes/${indexName}`, { method: "DELETE", headers: { Authorization: `Bearer ${MASTER}` } }); });

  const all = entityTypesForRoles(["super_admin"]);
  const refs = (r: { hits: Array<{ refNumber: string }> }) => r.hits.map((h) => h.refNumber).sort();

  it("tenant B never sees tenant A's contracts, meetings, files or applications (incl. crafted q)", async () => {
    for (const q of ["Zeta", "APP", `Zeta" OR tenantId = "${A}`, `tenantId = "${A}"`]) {
      const r = await idx.search({ tenantId: B, q, entityTypes: all });
      for (const h of r.hits) expect(h.refNumber).toMatch(/-B$|^F-B$/);
    }
    expect(refs(await idx.search({ tenantId: A, q: "Zeta", entityTypes: all }))).toEqual(["CON-A", "F-A", "MTG-A"]);
  });
  it("roles: applicant and employee see nothing; officer sees only applications; estab sees only files", async () => {
    expect((await idx.search({ tenantId: A, q: "APP", entityTypes: entityTypesForRoles(["citizen"]) })).hits).toEqual([]);
    expect((await idx.search({ tenantId: A, q: "Zeta", entityTypes: entityTypesForRoles(["employee"]) })).hits).toEqual([]);
    expect(refs(await idx.search({ tenantId: A, q: "APP", entityTypes: entityTypesForRoles(["citizen_officer"]) }))).toEqual(["APP-A"]);
    expect(refs(await idx.search({ tenantId: A, q: "Zeta", entityTypes: entityTypesForRoles(["estab_officer"]) }))).toEqual(["F-A"]);
    expect(refs(await idx.search({ tenantId: A, q: "Zeta", entityTypes: entityTypesForRoles(["committee_member"]) }))).toEqual(["MTG-A"]);
  });
});
