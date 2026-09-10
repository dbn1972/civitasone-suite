/**
 * PERF-019 regression tests — legal-service tranche.
 *
 * Covers the 3 legal-service sites named in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-019 row:
 *   - hearings/queries.ts::listHearingSummaries    (was N+1 via findCaseById per row)
 *   - hearings/queries.ts::listCourtOrderSummaries (was N+1 via findCaseById per row)
 *   - reminders/routes.ts GET /v1/legal/hearings/upcoming (was N+1 via
 *     Promise.all(findCaseById) — concurrent, but still N round trips)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook), only counting
 * anything when DB_QUERY_DEBUG=true is set at test-run time (see
 * packages/db/src/pool.ts) — mirrors PERF-005 tranche 1's
 * perf-005-n-plus-one.test.ts files exactly. The primary assertion in each
 * test is O(1)-not-O(N): the same function/route issues the SAME query count
 * for a small (3-row) dataset and a large (20-row) one.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalHearings, legalOrders } from "../src/modules/hearings/schema.js";
import { listHearingSummaries, listCourtOrderSummaries } from "../src/modules/hearings/queries.js";
import { buildApp } from "../src/app.js";

const ACTOR = "80000000-aaaa-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SMALL_N = 3;
const LARGE_N = 20;

function token(tenant: string, roles = ["legal_officer", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "perf019" }, SECRET);
}

async function seedCasesAndHearings(tenant: string, n: number) {
  const now = new Date();
  const cases = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, caseNo: `PERF019-C-${i}`, title: `Case ${i}`,
    court: `Court ${i}`, status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const hearings = cases.map((c, i) => ({
    id: randomUUID(), tenantId: tenant, caseId: c.id,
    hearingDate: new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    court: c.court, status: "scheduled", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const orders = cases.map((c, i) => ({
    id: randomUUID(), tenantId: tenant, caseId: c.id, orderType: "interim",
    summary: `Order ${i}`, orderDate: now.toISOString().slice(0, 10),
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(legalCases).values(cases);
    await tx.insert(legalHearings).values(hearings);
    await tx.insert(legalOrders).values(orders);
  }));
  return { cases, hearings, orders };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(legalOrders).where(eq(legalOrders.tenantId, tenant));
    await tx.delete(legalHearings).where(eq(legalHearings.tenantId, tenant));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-019 — legal-service N+1 fixes", () => {
  it("listHearingSummaries: query count is O(1) not O(N), caseNo/caseTitle resolve correctly (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seedCasesAndHearings(tenantSmall, SMALL_N);
    const large = await seedCasesAndHearings(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listHearingSummaries(tenantSmall, 100)));
      const { result: summaries, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listHearingSummaries(tenantLarge, 100)));

      // O(1): identical round-trip count whether the tenant has 3 hearings or
      // 20. The old per-row findCaseById loop would have made ~17 more
      // queries for the 20-row tenant than the 3-row one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(summaries).toHaveLength(LARGE_N);
      const caseById = new Map(large.cases.map((c) => [c.id, c]));
      for (const summary of summaries) {
        const legalCase = caseById.get(summary.caseId)!;
        expect(summary.caseNo).toBe(legalCase.caseNo);
        expect(summary.caseTitle).toBe(legalCase.title);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("listCourtOrderSummaries: query count is O(1) not O(N), caseNo/court resolve correctly (was N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seedCasesAndHearings(tenantSmall, SMALL_N);
    const large = await seedCasesAndHearings(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listCourtOrderSummaries(tenantSmall, 100)));
      const { result: summaries, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listCourtOrderSummaries(tenantLarge, 100)));

      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(summaries).toHaveLength(LARGE_N);
      const caseById = new Map(large.cases.map((c) => [c.id, c]));
      for (const summary of summaries) {
        const legalCase = caseById.get(summary.caseId)!;
        expect(summary.caseNo).toBe(legalCase.caseNo);
        expect(summary.court).toBe(legalCase.court);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("GET /v1/legal/hearings/upcoming: query count is O(1) not O(N) (was N+1 via Promise.all)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seedCasesAndHearings(tenantSmall, SMALL_N);
    const large = await seedCasesAndHearings(tenantLarge, LARGE_N);

    const app = await buildApp();
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        app.inject({ method: "GET", url: "/v1/legal/hearings/upcoming", headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall } }));
      const { result: res, queryCount: countLarge } = await countQueriesDuring(() =>
        app.inject({ method: "GET", url: "/v1/legal/hearings/upcoming", headers: { authorization: `Bearer ${token(tenantLarge)}`, "x-tenant-id": tenantLarge } }));

      expect(res.statusCode).toBe(200);
      // O(1): identical round-trip count whether 3 or 20 upcoming hearings
      // match. The old Promise.all(findCaseById) loop made one additional
      // (concurrent but real) query per hearing.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      const body = res.json() as { data: Array<{ caseId: string; caseNo: string; caseTitle: string }>; total: number };
      expect(body.total).toBe(LARGE_N);
      const caseById = new Map(large.cases.map((c) => [c.id, c]));
      for (const row of body.data) {
        const legalCase = caseById.get(row.caseId)!;
        expect(row.caseNo).toBe(legalCase.caseNo);
        expect(row.caseTitle).toBe(legalCase.title);
      }
    } finally {
      await app.close();
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
