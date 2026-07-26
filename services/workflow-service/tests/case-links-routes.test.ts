/** CAP-033 — case links/split/merge over the real DB (RLS-forced). */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1a50000-0000-4000-8000-000000000033";
const token = () => signToken({ sub: randomUUID(), tid: TENANT, roles: ["case_manager"], sid: "s" }, SECRET);

async function seedCase(title = "Parent"): Promise<string> {
  const id = randomUUID();
  await sqlAsTenant(TENANT, sql`INSERT INTO workflow.cases (id, tenant_id, case_number, title, case_type, source_service, source_ref_id, created_by)
    VALUES (${id}, ${TENANT}, ${"CN-" + id.slice(0, 8)}, ${title}, 'generic', 'test', ${randomUUID()}, ${randomUUID()})`);
  return id;
}

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.case_links WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.cases WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

describe("CAP-033 split", () => {
  it("splits a parent into children whose allocation sums to 100", async () => {
    const app = await buildApp();
    const parent = await seedCase();
    const res = await app.inject({
      method: "POST", url: `/v1/workflow/cases/${parent}/split`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { children: [
        { title: "Child A", caseType: "generic", allocation: 70 },
        { title: "Child B", caseType: "generic", allocation: 30 },
      ] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.childCount).toBe(2);
    // parent is now status=split, children exist with split_from links
    const kids = await sqlAsTenant<{ n: string }>(TENANT, sql`SELECT count(*)::text AS n FROM workflow.cases WHERE parent_case_id = ${parent}`);
    expect(kids[0]!.n).toBe("2");
    const links = await sqlAsTenant<{ n: string }>(TENANT, sql`SELECT count(*)::text AS n FROM workflow.case_links WHERE tenant_id = ${TENANT} AND link_type = 'split_from'`);
    expect(links[0]!.n).toBe("2");
    await app.close();
  });

  it("rejects a split whose allocations do not sum to 100", async () => {
    const app = await buildApp();
    const parent = await seedCase();
    const res = await app.inject({
      method: "POST", url: `/v1/workflow/cases/${parent}/split`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { children: [
        { title: "A", caseType: "generic", allocation: 70 },
        { title: "B", caseType: "generic", allocation: 20 },
      ] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("CAP-033 links + cycle prevention", () => {
  it("blocks a parent_child link that would create a cycle", async () => {
    const app = await buildApp();
    const a = await seedCase("A");
    const b = await seedCase("B");
    const ok = await app.inject({ method: "POST", url: `/v1/workflow/cases/${a}/links`, headers: { authorization: `Bearer ${token()}` }, payload: { toCaseId: b, linkType: "parent_child" } });
    expect(ok.statusCode).toBe(201);
    const cycle = await app.inject({ method: "POST", url: `/v1/workflow/cases/${b}/links`, headers: { authorization: `Bearer ${token()}` }, payload: { toCaseId: a, linkType: "parent_child" } });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().message).toContain("CYCLE_DETECTED");
    await app.close();
  });

  it("blocks a duplicate-of link whose target is already a duplicate", async () => {
    const app = await buildApp();
    const a = await seedCase("A");
    const b = await seedCase("B");
    const c = await seedCase("C");
    await app.inject({ method: "POST", url: `/v1/workflow/cases/${b}/links`, headers: { authorization: `Bearer ${token()}` }, payload: { toCaseId: c, linkType: "duplicate_of" } });
    const chain = await app.inject({ method: "POST", url: `/v1/workflow/cases/${a}/links`, headers: { authorization: `Bearer ${token()}` }, payload: { toCaseId: b, linkType: "duplicate_of" } });
    expect(chain.statusCode).toBe(400);
    expect(chain.json().message).toContain("DUPLICATE_OF_A_DUPLICATE");
    await app.close();
  });
});

describe("CAP-033 merge", () => {
  it("consolidates two sources into a target and marks them merged", async () => {
    const app = await buildApp();
    const target = await seedCase("Target");
    const s1 = await seedCase("S1");
    const s2 = await seedCase("S2");
    const res = await app.inject({ method: "POST", url: `/v1/workflow/cases/merge`, headers: { authorization: `Bearer ${token()}` }, payload: { sourceIds: [s1, s2], targetId: target, reason: "duplicates" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mergedCount).toBe(2);
    const merged = await sqlAsTenant<{ n: string }>(TENANT, sql`SELECT count(*)::text AS n FROM workflow.cases WHERE merged_into_case_id = ${target}`);
    expect(merged[0]!.n).toBe("2");
    await app.close();
  });
});

describe("CAP-033 concurrency + status guards (PR #169)", () => {
  // HIGH: fire A->B and B->A parent_child creates together. createLinkChecked
  // locks both case rows FOR UPDATE and re-reads links inside the tx, so the two
  // requests serialize: exactly one commits (201), the loser re-reads the now-
  // committed edge, its cycle check fails, and it 409s. The graph never cycles.
  it("serializes concurrent A->B / B->A link creates so exactly one wins and no cycle forms", async () => {
    const app = await buildApp();
    const a = await seedCase("A");
    const b = await seedCase("B");
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/workflow/cases/${a}/links`, headers: { authorization: `Bearer ${token()}` }, payload: { toCaseId: b, linkType: "parent_child" } }),
      app.inject({ method: "POST", url: `/v1/workflow/cases/${b}/links`, headers: { authorization: `Bearer ${token()}` }, payload: { toCaseId: a, linkType: "parent_child" } }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json().message).toContain("CYCLE_DETECTED");
    // Exactly one edge persisted -> no cycle.
    const links = await sqlAsTenant<{ n: string }>(TENANT, sql`SELECT count(*)::text AS n FROM workflow.case_links WHERE tenant_id = ${TENANT} AND link_type = 'parent_child'`);
    expect(links[0]!.n).toBe("1");
    await app.close();
  });

  // MEDIUM: a second split of an already-split parent must 409, never create a
  // second child set (which would push allocation to 200%).
  it("rejects a second split of an already-split parent and keeps allocation at 100%", async () => {
    const app = await buildApp();
    const parent = await seedCase("P");
    const first = await app.inject({
      method: "POST", url: `/v1/workflow/cases/${parent}/split`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { children: [ { title: "A", caseType: "generic", allocation: 60 }, { title: "B", caseType: "generic", allocation: 40 } ] },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST", url: `/v1/workflow/cases/${parent}/split`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { children: [ { title: "C", caseType: "generic", allocation: 50 }, { title: "D", caseType: "generic", allocation: 50 } ] },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("CASE_NOT_OPEN");
    // Only the first split's children exist; total allocation stays 100.
    const kids = await sqlAsTenant<{ n: string }>(TENANT, sql`SELECT count(*)::text AS n FROM workflow.cases WHERE parent_case_id = ${parent}`);
    expect(kids[0]!.n).toBe("2");
    const alloc = await sqlAsTenant<{ s: string | null }>(TENANT, sql`SELECT coalesce(sum(allocation),0)::text AS s FROM workflow.case_links WHERE tenant_id = ${TENANT} AND to_case_id = ${parent} AND link_type = 'split_from'`);
    expect(Number(alloc[0]!.s)).toBeLessThanOrEqual(100);
    expect(Number(alloc[0]!.s)).toBe(100);
    await app.close();
  });

  // MEDIUM: an already-split case cannot be consumed as a merge source.
  it("rejects a merge that uses an already-split case as a source", async () => {
    const app = await buildApp();
    const split = await seedCase("Split");
    const other = await seedCase("Other");
    const target = await seedCase("Target");
    const sp = await app.inject({
      method: "POST", url: `/v1/workflow/cases/${split}/split`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { children: [ { title: "A", caseType: "generic" }, { title: "B", caseType: "generic" } ] },
    });
    expect(sp.statusCode).toBe(201);
    const res = await app.inject({ method: "POST", url: `/v1/workflow/cases/merge`, headers: { authorization: `Bearer ${token()}` }, payload: { sourceIds: [split, other], targetId: target, reason: "dupes" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CASE_NOT_OPEN");
    // The un-split source must NOT have been merged (whole tx rolled back).
    const merged = await sqlAsTenant<{ n: string }>(TENANT, sql`SELECT count(*)::text AS n FROM workflow.cases WHERE merged_into_case_id = ${target}`);
    expect(merged[0]!.n).toBe("0");
    await app.close();
  });
});

