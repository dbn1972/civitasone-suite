/**
 * TX-001 (grant-service slice) -- dashboard module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via a manual trace of every db.transaction()/scopedRead() block in
 * grant-service (the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep
 * evidence column cited exactly this one site -- `grant route
 * dashboard/queries.ts:71` -- and an independent full-service scan found no
 * others; every consumer.ts/repo.ts in this service had already been routed
 * onto *Tx siblings in an earlier pass, before this campaign's systematic
 * sweep):
 *
 *   getDashboard() opens an outer scopedRead(async (tx) => {...}) and, from
 *   INSIDE it, calls getOverdueApplicationIds(tenantId) -- which itself
 *   independently opens its OWN scopedRead()/db.transaction(), i.e. a
 *   second, nested pool connection borrowed while the outer one is still
 *   held open. Under pool.max concurrent in-flight dashboard requests (a
 *   realistic trigger -- e.g. many tenant admins loading the grants
 *   dashboard at once), the nested call has no free connection to open on
 *   and deadlocks the pool silently.
 *
 *   This is the scanner blind spot TX-011 documents: scan_nested_tx_v2.py
 *   does not recognize scopedRead() as an outer-transaction opener, so it
 *   never flagged getDashboard() as "inside a transaction" in the first
 *   place, and reports 0 genuine findings for this service.
 *
 * This test drives getDashboard() directly (it is called from an HTTP GET
 * route with no queue involved -- see dashboard/routes.ts) at
 * pool.max + 3 concurrency, real Postgres, real pool, many tenant requests
 * for the same tenant's dashboard at once.
 *
 * Fixed by routing the nested call onto getOverdueApplicationIdsTx(tx, ...),
 * reading through the caller's already-open tx instead of opening a second
 * one.
 *
 * Sabotage check (see PR body): reverting the call site in getDashboard()
 * back to the bare getOverdueApplicationIds(tenantId) reproduces the drain
 * timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { grantDisbursements } from "../src/modules/disbursement/schema.js";
import { grantComplianceReports } from "../src/modules/utilisation/schema.js";
import * as dashboardQueries from "../src/modules/dashboard/queries.js";

const TENANT = "7a161000-dead-4000-8000-00000000d1a5";
const ACTOR = "7a161000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer -- this test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

// Approved > 90 days ago, with NO compliance report -> genuinely overdue,
// so getOverdueApplicationIdsTx has real work (a full table scan + a nested
// per-row compliance-report lookup) to do on every concurrent call, not a
// trivial empty-set short-circuit.
const APPROVED_LONG_AGO = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(grantComplianceReports).where(eq(grantComplianceReports.tenantId, TENANT));
      await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
      await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
      await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      const beneficiaryId = randomUUID();
      await tx.insert(grantBeneficiaries).values({
        id: beneficiaryId, tenantId: TENANT, name: "TX-001 Deadlock Fixture Trust",
        type: "institution", incomeAnnualMinor: 0n, currency: "INR", status: "active",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      // A handful of overdue applications so getOverdueApplicationIdsTx does
      // real, non-trivial nested-read work on every concurrent call.
      for (let i = 0; i < 5; i++) {
        await tx.insert(grantApplications).values({
          id: randomUUID(), tenantId: TENANT, grantNo: `GNT-TX001/${i}`,
          schemeId: randomUUID(), beneficiaryId, purpose: "TX-001 fixture",
          amountRequestedMinor: 100000n, amountApprovedMinor: 100000n,
          currency: "INR", status: "approved", approvedAt: APPROVED_LONG_AGO,
          createdBy: ACTOR, updatedBy: ACTOR,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("dashboard queries getDashboard -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent getDashboard() calls for the same tenant complete without deadlocking the connection pool`,
    async () => {
      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;

      const calls = Array.from({ length: CONCURRENCY }, () => dashboardQueries.getDashboard(TENANT));

      const results = await Promise.race([
        Promise.all(calls).then((r) => ({ r, timedOut: false })),
        new Promise<{ r: null; timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ r: null, timedOut: true }), DRAIN_TIMEOUT_MS)),
      ]);
      timedOut = results.timedOut;

      expect(timedOut, `${CONCURRENCY} concurrent getDashboard() calls did not complete within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);

      // Prove the fix didn't just avoid the deadlock but that every concurrent
      // call actually got the right, real overdue count -- not an empty/short-
      // circuited result masking a swallowed error.
      const dashboards = results.r!;
      expect(dashboards).toHaveLength(CONCURRENCY);
      for (const dashboard of dashboards) {
        expect(dashboard.overdueGrants, "overdue count did not reflect the 5 fixture applications").toBe(5);
        expect(dashboard.overdueGrantIds).toHaveLength(5);
        expect(dashboard.totalGrants).toBeGreaterThanOrEqual(5);
      }
    },
    { timeout: 20_000 },
  );
});
