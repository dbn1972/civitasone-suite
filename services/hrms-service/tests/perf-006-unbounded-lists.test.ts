/**
 * PERF-006 regression test — hrms-service, ai-fraud module.
 *
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md names `ai-fraud/routes.ts:45`
 * (the ORIGINAL line numbering, before this fix's edits): a plain
 * `db.select().from(hrmsEmployees).where(eq(tenantId))` with no limit at
 * all, inside POST /v1/hrms/ai/scan. This file also covers a second,
 * closely related unbounded site found in the SAME file while fixing the
 * named one: GET /v1/hrms/ai/risk-scores (line 92 in the original file) had
 * the identical `db.select()...where(tenantId)`-with-no-limit pattern, one
 * row per employee.
 *
 * Two different fixes, so two different regression strategies:
 *
 *  - risk-scores is a genuine client-facing list endpoint -- fixed with the
 *    same limit/offset + pagination-metadata convention as this campaign's
 *    other PERF-006 sites. Tested here via HTTP (buildApp + inject), like
 *    tests/routes-coverage-g.test.ts already does for this route, but
 *    walking real pages instead of a single not-404 smoke check.
 *
 *  - the scan endpoint's employee fetch is an internal full-tenant-scan
 *    operation (duplicate-bank-account / ghost-employee detection both need
 *    to see every employee, not a client-chosen page), so it can't become a
 *    paginated list without changing what the feature does. Fixed instead
 *    by extracting fetchAllEmployeesForScan(), which walks the same table in
 *    SCAN_BATCH_SIZE(500)-row pages internally and concatenates them, so no
 *    single query is unbounded even though the function still returns
 *    every employee. Tested at the function level directly (like
 *    tests/perf-005-n-plus-one.test.ts's query-function-level cases in this
 *    same service) with countQueriesDuring proving it actually paged (2
 *    queries for 520 seeded rows against a batch size of 500), not one
 *    unbounded shot.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsEmployeeRiskScores } from "../src/modules/ai-fraud/schema.js";
import { fetchAllEmployeesForScan } from "../src/modules/ai-fraud/routes.js";
import { buildApp } from "../src/app.js";

const ACTOR = "70000000-bbbb-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles: ["hr_admin"], sid: "perf006" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-006 — hrms-service ai-fraud unbounded tenant-wide queries", () => {
  it("fetchAllEmployeesForScan: pages internally (2 queries for 520 rows at batch size 500), still returns every employee", async () => {
    const tenant = randomUUID();
    const TOTAL = 520; // > SCAN_BATCH_SIZE (500) -- forces a second page
    const employees = Array.from({ length: TOTAL }, (_, i) => ({
      id: randomUUID(), tenantId: tenant, employeeNo: `SCN-${i}`, fullName: `Scan Employee ${i}`,
      departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-01",
      status: "confirmed", createdBy: ACTOR, updatedBy: ACTOR,
    } as const));
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.insert(hrmsEmployees).values(employees as never);
    }));
    try {
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => fetchAllEmployeesForScan(tenant)));

      // Was one unbounded scopedRead(); now exactly ceil(520/500) = 2 pages,
      // regardless of how many employees the tenant actually has. Each page
      // is one scopedRead() = one db.transaction(), and (matching this
      // service's other perf tests, e.g. tests/perf-005-n-plus-one.test.ts)
      // wrapWithTenantGuc turns that into 4 round trips -- BEGIN/`SET LOCAL
      // app.tenant_id`/SELECT/COMMIT -- so 2 pages is 8, not 2.
      expect(queryCount).toBe(8);
      expect(result).toHaveLength(TOTAL);
      const ids = new Set(result.map((e) => e.id));
      expect(ids.size).toBe(TOTAL); // no duplicates/gaps across the page boundary
      for (const e of employees) expect(ids.has(e.id)).toBe(true);
    } finally {
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, tenant));
      }));
    }
  });

  it("GET /v1/hrms/ai/risk-scores: bounded page regardless of how many risk-score rows the tenant has", async () => {
    const tenant = randomUUID();
    const PAGE_SIZE = 10;
    const TOTAL = 25; // 2.5x PAGE_SIZE -- forces 3 pages
    const rows = Array.from({ length: TOTAL }, () => ({ tenantId: tenant, employeeId: randomUUID() }));
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.insert(hrmsEmployeeRiskScores).values(rows);
    }));
    const app = await buildApp();
    const tok = token(tenant);
    try {
      const seen = new Set<string>();
      let offset = 0;
      let pages = 0;
      for (;;) {
        const res = await app.inject({
          method: "GET",
          url: `/v1/hrms/ai/risk-scores?limit=${PAGE_SIZE}&offset=${offset}`,
          headers: { authorization: `Bearer ${tok}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { data: Array<{ id: string }>; pagination: { hasMore: boolean; pageSize: number } };
        expect(body.data.length).toBeLessThanOrEqual(PAGE_SIZE); // bounded regardless of the 25 rows underneath
        expect(body.pagination.pageSize).toBe(PAGE_SIZE);
        for (const r of body.data) seen.add(r.id);
        pages++;
        if (!body.pagination.hasMore) break;
        expect(body.data.length).toBe(PAGE_SIZE);
        offset += body.data.length;
        if (pages > 10) throw new Error("pagination never terminated");
      }
      expect(seen.size).toBe(TOTAL);
      expect(pages).toBeGreaterThan(1);
    } finally {
      await app.close();
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.delete(hrmsEmployeeRiskScores).where(eq(hrmsEmployeeRiskScores.tenantId, tenant));
      }));
    }
  });
});
