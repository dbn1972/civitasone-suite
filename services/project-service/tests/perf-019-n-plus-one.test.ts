/**
 * PERF-019 regression tests — project-service tranche.
 *
 * Covers the 3 project-service sites named in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-019 row:
 *   - project/queries.ts::listProjectSummaries   (was N+1 via findSchemeById per row)
 *   - project/queries.ts::listMilestoneSummaries (was N+1 via findProjectById per row)
 *   - scheme/queries.ts::listSchemeSummaries     (was N+1 via countProjectsByScheme per row)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook, not a mock), so
 * a "query" here is an actual protocol round trip, including the
 * BEGIN/SET-GUC/COMMIT statements db.transaction()/runWithTenant() wrap every
 * call in — which is why the bounded constant per function is >1 even though
 * each is "a handful of SQL statements", not literally 1. This only counts
 * anything when DB_QUERY_DEBUG=true is set at test-run time (see
 * packages/db/src/pool.ts) — mirrors PERF-005 tranche 1's grant/payroll/hrms
 * perf-005-n-plus-one.test.ts files exactly.
 *
 * The primary assertion in each test is O(1)-not-O(N): the exact same
 * function issues the SAME query count for a small (3-row) tenant and a
 * large (20-row) tenant. That is what actually distinguishes "batched" from
 * "N+1" — a per-row-loop's count scales with N; a batch loader's does not.
 * A loose upper-bound sanity check backs it up in case both measurements
 * were wrong in the same direction.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { projectProjects, projectMilestones } from "../src/modules/project/schema.js";
import { projectSchemes } from "../src/modules/scheme/schema.js";
import { listProjectSummaries, listMilestoneSummaries } from "../src/modules/project/queries.js";
import { listSchemeSummaries } from "../src/modules/scheme/queries.js";

const ACTOR = "70000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 20;

async function wipeProjectTables(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(projectMilestones).where(eq(projectMilestones.tenantId, tenant));
    await tx.delete(projectProjects).where(eq(projectProjects.tenantId, tenant));
    await tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-019 — project-service N+1 fixes", () => {
  it("listProjectSummaries: query count is O(1) not O(N), scheme name resolves correctly (was N+1)", async () => {
    async function seed(tenant: string, n: number) {
      const schemes = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(), tenantId: tenant, code: `SCH-${i}`, name: `Scheme ${i}`,
        type: "css", fundingPattern: "100", totalOutlayMinor: 1000000n, releasedMinor: 0n,
        createdBy: ACTOR, updatedBy: ACTOR,
      }));
      const projects = schemes.map((s, i) => ({
        id: randomUUID(), tenantId: tenant, code: `PRJ-${i}`, name: `Project ${i}`,
        schemeId: s.id, dprCostMinor: 500000n, sanctionedMinor: 500000n,
        status: "active", physicalPct: "10", financialPct: "10", rag: "green",
        createdBy: ACTOR, updatedBy: ACTOR,
      }));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(projectSchemes).values(schemes);
        await tx.insert(projectProjects).values(projects);
      }));
      return { schemes, projects };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listProjectSummaries(tenantSmall, 100)));
      const { result: summaries, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listProjectSummaries(tenantLarge, 100)));

      // O(1): identical round-trip count whether the tenant has 3 projects or
      // 20. The old per-row findSchemeById loop would have made ~17 more
      // queries for the 20-row tenant than the 3-row one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16); // sanity bound, not the primary assertion

      expect(summaries).toHaveLength(LARGE_N);
      const schemeById = new Map(large.schemes.map((s) => [s.id, s]));
      for (const summary of summaries) {
        const project = large.projects.find((p) => p.code === summary.projectCode)!;
        const scheme = schemeById.get(project.schemeId)!;
        expect(summary.scheme).toBe(scheme.name);
      }
    } finally {
      await wipeProjectTables(tenantSmall);
      await wipeProjectTables(tenantLarge);
    }
  });

  it("listMilestoneSummaries: query count is O(1) not O(N), project name resolves correctly (was N+1)", async () => {
    async function seed(tenant: string, n: number) {
      const projects = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(), tenantId: tenant, code: `MPRJ-${i}`, name: `Milestone Project ${i}`,
        dprCostMinor: 500000n, sanctionedMinor: 500000n, status: "active",
        physicalPct: "10", financialPct: "10", rag: "green",
        createdBy: ACTOR, updatedBy: ACTOR,
      }));
      const milestones = projects.map((p, i) => ({
        id: randomUUID(), tenantId: tenant, projectId: p.id, name: `Milestone ${i}`,
        plannedDate: "2026-12-01", status: "pending",
        createdBy: ACTOR, updatedBy: ACTOR,
      }));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(projectProjects).values(projects);
        await tx.insert(projectMilestones).values(milestones);
      }));
      return { projects, milestones };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listMilestoneSummaries(tenantSmall, 100)));
      const { result: summaries, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listMilestoneSummaries(tenantLarge, 100)));

      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(summaries).toHaveLength(LARGE_N);
      const projectById = new Map(large.projects.map((p) => [p.id, p]));
      for (const summary of summaries) {
        const project = projectById.get(summary.projectId)!;
        expect(summary.projectName).toBe(project.name);
      }
    } finally {
      await wipeProjectTables(tenantSmall);
      await wipeProjectTables(tenantLarge);
    }
  });

  it("listSchemeSummaries: query count is O(1) not O(N), projectCount matches actual count (was N+1)", async () => {
    async function seed(tenant: string, n: number) {
      const schemes = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(), tenantId: tenant, code: `PSCH-${i}`, name: `PSch ${i}`,
        type: "css", fundingPattern: "100", totalOutlayMinor: 1000000n, releasedMinor: 200000n,
        createdBy: ACTOR, updatedBy: ACTOR,
      }));
      // 2 projects per scheme, so projectCount is a real, non-trivial value.
      const projects = schemes.flatMap((s, i) => Array.from({ length: 2 }, (_, j) => ({
        id: randomUUID(), tenantId: tenant, code: `PSPRJ-${i}-${j}`, name: `PSPrj ${i}-${j}`,
        schemeId: s.id, dprCostMinor: 100000n, sanctionedMinor: 100000n, status: "active",
        physicalPct: "10", financialPct: "10", rag: "green",
        createdBy: ACTOR, updatedBy: ACTOR,
      })));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(projectSchemes).values(schemes);
        await tx.insert(projectProjects).values(projects);
      }));
      return { schemes, projects };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listSchemeSummaries(tenantSmall, 100)));
      const { result: summaries, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listSchemeSummaries(tenantLarge, 100)));

      // O(1): identical round-trip count whether the tenant has 3 schemes or
      // 20. The old per-row countProjectsByScheme loop would have made ~17
      // more COUNT queries for the 20-row tenant than the 3-row one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(summaries).toHaveLength(LARGE_N);
      const schemeById = new Map(large.schemes.map((s) => [s.id, s]));
      for (const summary of summaries) {
        expect(schemeById.has(summary.id)).toBe(true);
        expect(summary.projectCount).toBe(2);
      }
    } finally {
      await wipeProjectTables(tenantSmall);
      await wipeProjectTables(tenantLarge);
    }
  });
});
