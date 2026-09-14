/**
 * PERF-005 tranche 2 regression test — admin-service.
 *
 * NOTE ON SCOPE: admin-service was not named at all in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's original PERF-005/PERF-019 rows.
 * This is a newly-discovered N+1 found by an independent codebase-wide grep
 * for the same anti-pattern (`Promise.all(rows.map(async ...))` doing a
 * per-row DB call after an initial list query). See this tranche's PR
 * description for the full list of newly-discovered sites.
 *
 * Covers:
 *   - sandbox/routes.ts's GET /v1/admin/sandbox-refreshes (was 2N+1: jobPlan()
 *     -> listMaskingRules() issued a rows query AND a count query jobPlan
 *     never read, once PER job row)
 *
 * Goes through the real HTTP boundary (buildApp + inject) since the fix
 * lives entirely in routes.ts (jobPlanFromRules + the list handler), not a
 * separate queries.ts layer. Query counting uses the real driver-level
 * counter from @civitasone/db (countQueriesDuring), only counting anything
 * when DB_QUERY_DEBUG=true is set at test-run time — mirrors PERF-005/
 * PERF-019's own test files.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { sandboxEnvironments, maskingRules, refreshJobs } from "../src/modules/sandbox/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const SMALL_N = 3;
const LARGE_N = 20;
// Cycle through non-default strategies so a batch loader that mixes up
// rules across sandboxes (or drops any sandbox's rules) is visible per-row,
// not just in aggregate. "redact" is deliberately excluded -- it is also the
// fail-closed DEFAULT, so it wouldn't distinguish "rule matched" from
// "no rule found".
const STRATEGIES = ["hash", "partial", "nullify", "preserve"] as const;

function token(tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles: ["tenant_admin", "super_admin"], sid: "sess-perf005t2" }, SECRET);
}

async function seed(tenant: string, n: number) {
  const sandboxes = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, code: `perf005t2-${i}`, name: `Sandbox ${i}`,
    sourceEnvironment: "staging", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const rules = sandboxes.map((s, i) => ({
    id: randomUUID(), tenantId: tenant, sandboxId: s.id,
    tableName: "citizens", fieldName: "aadhaar",
    strategy: STRATEGIES[i % STRATEGIES.length],
    justification: STRATEGIES[i % STRATEGIES.length] === "preserve" ? "PERF-005 T2 test justification" : "",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const jobs = sandboxes.map((s) => ({
    id: randomUUID(), tenantId: tenant, sandboxId: s.id, sourceEnvironment: "staging",
    requestedFields: [{ tableName: "citizens", fieldName: "aadhaar" }],
    status: "completed" as const, requestedBy: ACTOR, updatedBy: ACTOR, createdBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(sandboxEnvironments).values(sandboxes);
    await tx.insert(maskingRules).values(rules);
    await tx.insert(refreshJobs).values(jobs);
  }));
  return { sandboxes, rules, jobs };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(refreshJobs).where(eq(refreshJobs.tenantId, tenant));
    await tx.delete(maskingRules).where(eq(maskingRules.tenantId, tenant));
    await tx.delete(sandboxEnvironments).where(eq(sandboxEnvironments.tenantId, tenant));
  }));
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("PERF-005 tranche 2 — admin-service N+1 fix", () => {
  it("GET /v1/admin/sandbox-refreshes: query count is O(1) not O(N), each job's plan resolves ITS OWN sandbox's rule correctly (was 2N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      // Warm-up (untimed): postgres-js resolves the element-type OID for an
      // array-bound parameter (inArray(sandboxIds) in
      // listMaskingRulesBySandboxIds) lazily on its first use per
      // process/connection, as an extra round trip -- a one-time driver
      // cost, not an application query -- that would otherwise land
      // arbitrarily on whichever of the two MEASURED calls below happens to
      // run first and break the O(1) comparison (see estab-service's
      // sibling perf-005-tranche2 test for the fuller writeup of this class
      // of bug, including a second, cache-collision-shaped failure mode
      // that route has and this one doesn't: sandbox/repo.ts and routes.ts
      // do no cache.getOrLoad() caching anywhere in this request path, so
      // reusing tenantSmall for warm-up here carries none of that risk).
      // Real seeded rows are required -- an empty sandboxIds list would
      // short-circuit listMaskingRulesBySandboxIds before it ever queries,
      // same reasoning as the sibling test file.
      await app.inject({
        method: "GET", url: "/v1/admin/sandbox-refreshes?limit=50",
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
      });

      const { result: resSmall, queryCount: countSmall } = await countQueriesDuring(() => app.inject({
        method: "GET", url: "/v1/admin/sandbox-refreshes?limit=50",
        headers: { authorization: `Bearer ${token(tenantSmall)}`, "x-tenant-id": tenantSmall },
      }));
      const { result: resLarge, queryCount: countLarge } = await countQueriesDuring(() => app.inject({
        method: "GET", url: "/v1/admin/sandbox-refreshes?limit=50",
        headers: { authorization: `Bearer ${token(tenantLarge)}`, "x-tenant-id": tenantLarge },
      }));

      expect(resSmall.statusCode).toBe(200);
      expect(resLarge.statusCode).toBe(200);

      // O(1): identical round-trip count whether the tenant has 3 refresh
      // jobs (3 distinct sandboxes) or 20. The old jobPlan()->listMaskingRules()
      // pair per job row would have made ~34 more queries for 20 jobs than 3.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(20);

      const body = resLarge.json() as { data: Array<{ id: string; sandboxId: string; plan?: { fields: Array<{ tableName: string; fieldName: string; strategy: string; ruleSource: string }> } }> };
      const jobIds = new Set(large.jobs.map((j) => j.id));
      const ourRows = body.data.filter((r) => jobIds.has(r.id));
      expect(ourRows).toHaveLength(LARGE_N);
      const strategyBySandbox = new Map(large.rules.map((r) => [r.sandboxId, r.strategy]));
      for (const row of ourRows) {
        expect(row.plan).toBeDefined();
        expect(row.plan!.fields).toHaveLength(1);
        const field = row.plan!.fields[0]!;
        expect(field.tableName).toBe("citizens");
        expect(field.fieldName).toBe("aadhaar");
        // The batch loader must resolve THIS job's OWN sandbox's rule, not
        // another sandbox's, not the fail-closed default.
        expect(field.ruleSource).toBe("rule");
        expect(field.strategy).toBe(strategyBySandbox.get(row.sandboxId));
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
