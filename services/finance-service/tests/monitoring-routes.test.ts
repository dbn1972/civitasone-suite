/**
 * SVC-039 — budget monitoring & forecasting HTTP integration against the dev DB.
 *
 * Seeds allocations with distinct spend profiles and proves the dashboard
 * computes availability/burn/forecast + exception flags, the exception-only
 * dashboard, the portfolio summary, RLS isolation and role gating.
 *
 * NOTE on the "over_committed" exception bucket: classifyException() flags a
 * line as over_committed when committed+actual > allocated (available < 0).
 * That row shape can no longer be persisted here — migrations/0056_allocation_no_overcommit.sql
 * added an unconditional DB CHECK (chk_allocation_no_overcommit) enforcing
 * committed_minor + actual_minor <= allocated_minor on every insert/update to
 * finance_budget_allocation, and allocation-repo.ts's addCommittedGuarded()
 * enforces the identical ceiling on the application write path before that
 * (see migrations/0067_drop_allocation_enforce.sql for the full history). So
 * an over-committed row is unreachable via any real write in this service —
 * this HTTP-integration file only proves the API surfaces the three
 * DB-reachable exception buckets correctly, plus that the over_committed key
 * is present (and zero) in the response shape. The classification logic
 * itself (including the over_committed branch) is unit-tested against the
 * pure domain function directly, without touching Postgres, in
 * tests/monitoring-domain.test.ts and tests/budget-monitoring-domain.test.ts.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa039";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb039";
const ACTOR = "00000000-aaaa-4000-8000-00000000a039";
const FY = "2025-26";
const AS_OF = "2025-09-30"; // ~half the FY

const OVERSPEND = randomUUID(), UNDER = randomUUID(), OK = randomUUID();

function token(tenant: string, roles: string[], sub = ACTOR) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-mon" }, SECRET);
}
const reader = (t = TENANT_A) => ({ authorization: `Bearer ${token(t, ["finance_officer"])}` });

// Fixed (not per-run random) so onConflictDoNothing() is truly idempotent:
// finance_heads has UNIQUE(tenant_id, code), so a fresh random id paired with
// a fixed code would silently no-op against a prior run's row on that same
// code, leaving the new id unlinked to any real row and 23503-ing downstream.
const HEAD_OVERSPEND = "aaaaaaaa-2222-4000-8000-0000000fa039";
const HEAD_UNDER = "aaaaaaaa-2222-4000-8000-0000000fb039";
const HEAD_OK = "aaaaaaaa-2222-4000-8000-0000000fc039";

async function seed() {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.fy, FY)));
  }
  // fk_falloc_head (migrations/0055_add_foreign_keys.sql) requires a parent
  // finance_heads row before finance_budget_allocation can reference it.
  // Delete-then-insert (not onConflictDoNothing) because these ids are fixed
  // constants but finance_heads also has UNIQUE(tenant_id, code) — a plain
  // onConflictDoNothing() would silently no-op against a stale same-code row
  // left over from a differently-shaped run, orphaning these ids.
  await scoped(TENANT_A, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT_A)));
  await scoped(TENANT_A, (tx) => tx.insert(financeHeads).values([
    { id: HEAD_OVERSPEND, tenantId: TENANT_A, code: "4800-OVERSPEND", name: "Monitoring Overspend Head", level: 2, createdBy: ACTOR, updatedBy: ACTOR },
    { id: HEAD_UNDER, tenantId: TENANT_A, code: "4800-UNDER", name: "Monitoring Underutilised Head", level: 2, createdBy: ACTOR, updatedBy: ACTOR },
    { id: HEAD_OK, tenantId: TENANT_A, code: "4800-OK", name: "Monitoring On-Track Head", level: 2, createdBy: ACTOR, updatedBy: ACTOR },
  ]));
  const mk = (id: string, head: string, alloc: bigint, com: bigint, act: bigint) => ({
    id, tenantId: TENANT_A, headId: head, fy: FY, allocatedMinor: alloc, committedMinor: com, actualMinor: act,
    enforce: true, currency: "INR", createdBy: ACTOR, updatedBy: ACTOR,
  });
  // No over_committed row here — see the file-header note: chk_allocation_no_overcommit
  // makes committed+actual > allocated unpersistable, so that bucket is exercised
  // only at the pure-domain unit-test level, not via a DB fixture.
  await scoped(TENANT_A, (tx) => tx.insert(financeBudgetAllocation).values([
    mk(OVERSPEND, HEAD_OVERSPEND, 1000n, 0n, 600n),  // projected_overspend at half-year
    mk(UNDER, HEAD_UNDER, 1000n, 0n, 100n),          // under_utilised
    mk(OK, HEAD_OK, 1000n, 0n, 450n),                // on_track
  ]));
}

beforeAll(seed);
afterAll(async () => {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.fy, FY)));
  }
  await sqlClient.end();
});

describe("SVC-039 monitoring — dashboard", () => {
  it("computes per-head availability/burn/forecast + exceptions and portfolio totals", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=${FY}&asOf=${AS_OF}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totals.count).toBe(3);
      expect(body.totals.allocatedMinor).toBe("3000");
      expect(body.totals.actualMinor).toBe("1150");
      // exception buckets: one head each for the DB-reachable exceptions;
      // over_committed stays present but zero (unreachable via a real row —
      // see the file-header note).
      expect(body.totals.exceptions.over_committed).toBe(0);
      expect(body.totals.exceptions.projected_overspend).toBe(1);
      expect(body.totals.exceptions.under_utilised).toBe(1);
      expect(body.totals.exceptions.on_track).toBe(1);

      const overspend = (body.lines as Array<Record<string, string>>).find((l) => l.id === OVERSPEND)!;
      expect(overspend.exception).toBe("projected_overspend");
      expect(BigInt(overspend.forecastYearEndMinor)).toBeGreaterThan(1000n);
    } finally { await app.close(); }
  });

  it("exception dashboard returns only heads needing attention", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring/exceptions?fy=${FY}&asOf=${AS_OF}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(2); // all but on_track
      expect((res.json().lines as Array<{ exception: string }>).every((l) => l.exception !== "on_track")).toBe(true);
    } finally { await app.close(); }
  });

  it("summary returns portfolio totals only", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring/summary?fy=${FY}&asOf=${AS_OF}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      expect(res.json().totals.count).toBe(3);
      expect(res.json().totals.availableMinor).toBeDefined();
    } finally { await app.close(); }
  });

  it("RLS: tenant B sees no allocations", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=${FY}`, headers: reader(TENANT_B) });
      expect(res.statusCode).toBe(200);
      expect(res.json().totals.count).toBe(0);
    } finally { await app.close(); }
  });

  it("rejects a malformed FY with 400", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=2025`, headers: reader() });
      expect(res.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=${FY}`, headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"])}` } });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
