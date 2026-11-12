/**
 * Real-engine isolation / permission / freshness tests. Needs a THROWAWAY Meilisearch:
 *   GLOBAL_SEARCH_TEST_MEILI_URL=http://127.0.0.1:<port>  GLOBAL_SEARCH_TEST_MEILI_KEY=<master key of that container>
 * Without them the suite is skipped (CI has no engine); it never touches MEILISEARCH_HOST / MEILISEARCH_API_KEY.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  GlobalSearchIndex, buildGlobalDocument, createTenantToken, entityTypesForRoles, runBackfill,
  type GlobalSearchRecordInput, type GlobalEntityType,
} from "../src/global/index.js";

const URL_ = process.env.GLOBAL_SEARCH_TEST_MEILI_URL;
const MASTER = process.env.GLOBAL_SEARCH_TEST_MEILI_KEY ?? "";
const run = URL_ ? describe : describe.skip;

run("global search against a real Meilisearch", () => {
  const indexName = `gs_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const A = randomUUID();
  const B = randomUUID();
  let searchKey = "";
  let searchKeyUid = "";
  let admin: GlobalSearchIndex;
  let tokened: GlobalSearchIndex;
  const ids: Record<string, string> = {};

  const rec = (tenantId: string, entityType: GlobalEntityType, title: string, ref: string, status = "active"): GlobalSearchRecordInput => {
    const entityId = randomUUID();
    ids[`${tenantId}:${ref}`] = entityId;
    return { entityType, entityId, tenantId, title, refNumber: ref, status };
  };
  const put = async (r: GlobalSearchRecordInput) => admin.waitForTask(await admin.upsert([buildGlobalDocument(r).doc]));

  beforeAll(async () => {
    admin = new GlobalSearchIndex({ host: URL_, apiKey: MASTER, indexName });
    await admin.waitForTask(await admin.initialize());
    const res = await fetch(`${URL_}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MASTER}` },
      body: JSON.stringify({ description: "gs-test search-only", actions: ["search"], indexes: [indexName], expiresAt: null }),
    });
    const k = (await res.json()) as { key: string; uid: string };
    searchKey = k.key;
    searchKeyUid = k.uid;
    tokened = new GlobalSearchIndex({ host: URL_, apiKey: MASTER, indexName, searchKey, searchKeyUid });
    const docs = [
      rec(A, "finance.vendor", "Acme Traders", "V-A1"),
      rec(A, "finance.bill", "Acme Bill", "BILL-A1", "pending"),
      rec(A, "hrms.employee", "Acme Employee Asha", "EMP-A1"),
      rec(B, "finance.vendor", "Acme Traders", "V-B1"),
      rec(B, "finance.bill", "Acme Bill", "BILL-B1"),
      rec(B, "hrms.employee", "Acme Employee Bimal", "EMP-B1"),
    ].map((r) => buildGlobalDocument(r).doc);
    await admin.waitForTask(await admin.upsert(docs));
  }, 60_000);

  afterAll(async () => {
    if (URL_) await fetch(`${URL_}/indexes/${indexName}`, { method: "DELETE", headers: { Authorization: `Bearer ${MASTER}` } });
  });

  const all = entityTypesForRoles(["super_admin"]);
  const refsOf = (r: { hits: Array<{ refNumber: string }> }) => r.hits.map((h) => h.refNumber).sort();

  it("a tenant B search never returns tenant A data (admin-key path, server-built filter)", async () => {
    const b = await admin.search({ tenantId: B, q: "Acme", entityTypes: all });
    expect(refsOf(b)).toEqual(["BILL-B1", "EMP-B1", "V-B1"]);
    const a = await admin.search({ tenantId: A, q: "Acme", entityTypes: all });
    expect(refsOf(a)).toEqual(["BILL-A1", "EMP-A1", "V-A1"]);
  });

  it("crafted query strings cannot widen the scope", async () => {
    const crafted = [
      `Acme" OR tenantId = "${A}`, `" OR tenantId != "${B}`, `Acme\\" OR 1 = 1 --`, `tenantId = "${A}"`, `*`, `Acme) OR (tenantId = "${A}"`,
      `Acme'; DROP INDEX x; --`, "Acme\u0000 OR tenantId = \"" + A + "\"",
    ];
    for (const q of crafted) {
      for (const idx of [admin, tokened]) {
        const r = await idx.search({ tenantId: B, q, entityTypes: all });
        for (const h of r.hits) expect(["V-B1", "BILL-B1", "EMP-B1"]).toContain(h.refNumber);
      }
    }
  });

  it("crafted tenant / type arguments are refused before reaching the engine", async () => {
    await expect(admin.search({ tenantId: `${B}" OR tenantId = "${A}`, q: "Acme", entityTypes: all })).rejects.toThrow();
    await expect(admin.search({ tenantId: B, q: "Acme", entityTypes: [`finance.bill" OR tenantId = "${A}` as never] })).rejects.toThrow();
  });

  it("a tenant token pins the tenant even when the caller supplies its own filter (engine-side)", async () => {
    const tokB = createTenantToken({ apiKey: searchKey, apiKeyUid: searchKeyUid, tenantId: B, indexName, expiresAtSec: Math.floor(Date.now() / 1000) + 300 });
    const raw = async (filter: unknown, token = tokB) =>
      fetch(`${URL_}/indexes/${indexName}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ q: "Acme", filter }),
      });
    for (const filter of [undefined, `tenantId = "${A}"`, `tenantId = "${A}" OR tenantId = "${B}"`, `tenantId != "${B}"`, [`tenantId = "${A}"`]]) {
      const res = await raw(filter);
      const body = (await res.json()) as { hits?: Array<{ tenantId: string }> };
      for (const h of body.hits ?? []) expect(h.tenantId).toBe(B);
    }
  });

  it("a forged, tampered or expired tenant token is rejected by the engine", async () => {
    const good = createTenantToken({ apiKey: searchKey, apiKeyUid: searchKeyUid, tenantId: B, indexName, expiresAtSec: Math.floor(Date.now() / 1000) + 300 });
    const [h, p, s] = good.split(".") as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    payload.searchRules[indexName].filter = `tenantId = "${A}"`;
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    const forged = createTenantToken({ apiKey: "not-the-search-key-0000000000", apiKeyUid: searchKeyUid, tenantId: A, indexName, expiresAtSec: Math.floor(Date.now() / 1000) + 300 });
    const expired = createTenantToken({ apiKey: searchKey, apiKeyUid: searchKeyUid, tenantId: B, indexName, expiresAtSec: Math.floor(Date.now() / 1000) - 60 });
    for (const tok of [tampered, forged, expired]) {
      const res = await fetch(`${URL_}/indexes/${indexName}/search`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify({ q: "Acme" }) });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    // And the search-only key cannot write.
    const w = await fetch(`${URL_}/indexes/${indexName}/documents`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${searchKey}` }, body: "[]" });
    expect(w.status).toBe(403);
  });

  it("tenant-token search returns the same, isolated results", async () => {
    expect(tokened.usesTenantTokens).toBe(true);
    expect(refsOf(await tokened.search({ tenantId: A, q: "Acme", entityTypes: all }))).toEqual(["BILL-A1", "EMP-A1", "V-A1"]);
    expect(refsOf(await tokened.search({ tenantId: B, q: "Acme", entityTypes: all }))).toEqual(["BILL-B1", "EMP-B1", "V-B1"]);
  });

  it("permissions: an employee sees nothing, finance sees no employees, hr sees only employees", async () => {
    expect((await admin.search({ tenantId: A, q: "Acme", entityTypes: entityTypesForRoles(["employee"]) })).hits).toEqual([]);
    expect(refsOf(await admin.search({ tenantId: A, q: "Acme", entityTypes: entityTypesForRoles(["finance_officer"]) }))).toEqual(["BILL-A1", "V-A1"]);
    expect(refsOf(await admin.search({ tenantId: A, q: "Acme", entityTypes: entityTypesForRoles(["hr_officer"]) }))).toEqual(["EMP-A1"]);
    // an employee asking for a voucher by exact number still gets nothing
    await put(rec(A, "finance.voucher", "Journal voucher", "JV-A-0001", "posted"));
    expect((await admin.search({ tenantId: A, q: "JV-A-0001", entityTypes: entityTypesForRoles(["employee"]) })).hits).toEqual([]);
    expect(refsOf(await admin.search({ tenantId: A, q: "JV-A-0001", entityTypes: entityTypesForRoles(["finance_officer"]) }))).toEqual(["JV-A-0001"]);
  });

  it("status changes and deletes reach the index", async () => {
    const r = rec(A, "procurement.po", "PO to Acme", "PO-A-77", "draft");
    await put(r);
    const types = entityTypesForRoles(["procurement_officer"]);
    expect((await admin.search({ tenantId: A, q: "PO-A-77", entityTypes: types })).hits[0]?.status).toBe("draft");
    await put({ ...r, status: "approved" });
    const after = await admin.search({ tenantId: A, q: "PO-A-77", entityTypes: types });
    expect(after.hits).toHaveLength(1);
    expect(after.hits[0]?.status).toBe("approved");
    await admin.waitForTask(await admin.remove(A, "procurement.po", r.entityId));
    expect((await admin.search({ tenantId: A, q: "PO-A-77", entityTypes: types })).hits).toEqual([]);
  });

  it("removing the same entity id for another tenant cannot delete this tenant's document", async () => {
    const r = rec(A, "finance.vendor", "Keep Me Traders", "V-KEEP");
    await put(r);
    await admin.waitForTask(await admin.remove(B, "finance.vendor", r.entityId));
    expect(refsOf(await admin.search({ tenantId: A, q: "Keep Me", entityTypes: all }))).toEqual(["V-KEEP"]);
  });

  it("an event for tenant B that reuses tenant A's entity id does not overwrite A's document", async () => {
    const r = rec(A, "finance.vendor", "Original Owner", "V-OWN");
    await put(r);
    await put({ ...r, tenantId: B, title: "Hijack", refNumber: "V-HIJACK" });
    expect(refsOf(await admin.search({ tenantId: A, q: "Original Owner", entityTypes: all }))).toEqual(["V-OWN"]);
  });

  it("backfill apply is idempotent and tenant-purge removes only that tenant", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, n: i + 1 }));
    const src = {
      tenantId: A,
      idOf: (r: { id: string }) => r.id,
      fetchPage: async (after: string | null, size: number) => rows.filter((r) => after === null || r.id > after).slice(0, size),
      toRecord: (r: { id: string; n: number }): GlobalSearchRecordInput => ({ entityType: "finance.vendor", entityId: r.id, tenantId: A, title: `Backfilled Vendor ${r.n}`, refNumber: `BF-${r.n}`, status: "active" }),
    };
    const sink = async (docs: Parameters<GlobalSearchIndex["upsert"]>[0]) => admin.waitForTask(await admin.upsert(docs));
    await runBackfill(src, { sink, pageSize: 2 });
    await runBackfill(src, { sink, pageSize: 2 });
    expect((await admin.search({ tenantId: A, q: "Backfilled", entityTypes: all })).hits).toHaveLength(5);
    await admin.waitForTask(await admin.removeTenant(A));
    expect((await admin.search({ tenantId: A, q: "Acme", entityTypes: all })).hits).toEqual([]);
    expect(refsOf(await admin.search({ tenantId: B, q: "Acme", entityTypes: all }))).toEqual(["BILL-B1", "EMP-B1", "V-B1"]);
  });
});
