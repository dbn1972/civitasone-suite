/**
 * payroll-service nested-transaction connection-pool deadlock regression,
 * tenantTransaction re-audit batch.
 *
 * lopRepo.getLopForMonth (integration/lop-repo.ts) used scopedRead(), which
 * opens its OWN db.transaction(). It was called from payroll/consumer.ts
 * processPayrollRun, once per employee, from inside that function own
 * already-open outer db.transaction(async (tx) => {...}). With pool.max
 * (10) concurrent outer transactions in flight, every one of them needs an
 * extra ("nested") pool connection at the same moment none is free,
 * deadlocking silently forever -- the same shape documented in
 * nested-tx-deadlock-regression.test.ts in this same file for
 * runApprove/runDisburse (PR #1028/#1035 class), found here during the
 * tenantTransaction re-audit of services fixed earlier in the session
 * (which only scanned for the scopedRead NAME pattern at call sites, not
 * every scopedRead-based repo function reachable from an outer tx).
 *
 * Fixed by adding lopRepo.getLopForMonthTx, a tx-scoped twin, and routing
 * the processPayrollRun call site onto it.
 *
 * The full runCreate -> processPayrollRun path needs a live HRMS employee
 * feed, salary structure and components -- unrelated setup for this bug.
 * Mirroring the precedent set by the workflow-service tasks/repo.ts
 * markCompleted/assignTx regression test in this same audit batch, this
 * test exercises the fixed call site directly at the repo layer, inside
 * the exact same already-open-outer-db.transaction shape the real
 * consumer uses, at pool.max + 3 concurrency, real Postgres, real pool.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollLopLedger } from "../src/modules/integration/schema.js";
import * as lopRepo from "../src/modules/integration/lop-repo.js";

const TENANT = "90000000-dead-4000-8000-00000000c0de";
const CONCURRENCY = 13;
const MONTH = "2026-09";

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT));
  }));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("payroll processPayrollRun -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent outer transactions each calling lopRepo.getLopForMonthTx (the real processPayrollRun call shape) drain without deadlocking the connection pool`,
    async () => {
      const employeeIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

      // One ledger row per employee, mirroring a real leave/attendance-fed month.
      await runWithTenant(TENANT, () => db.transaction(async (tx) => {
        for (let i = 0; i < employeeIds.length; i++) {
          await tx.insert(payrollLopLedger).values({
            tenantId: TENANT, employeeId: employeeIds[i], month: MONTH,
            lopDays: i + 1, source: "test",
          });
        }
      }));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      const results = await Promise.race([
        Promise.all(employeeIds.map((employeeId) =>
          runWithTenant(TENANT, () => db.transaction(async (tx) => {
            // Exactly the call shape used by processPayrollRun (consumer.ts):
            // an already-open outer db.transaction calling the Tx-scoped repo
            // function with its own tx, once per employee.
            return lopRepo.getLopForMonthTx(tx as unknown as typeof db, TENANT, employeeId, MONTH);
          })),
        )),
        new Promise<null>((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `did not complete within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      const rows = results as Array<{ hasLedger: boolean; days: number }>;
      expect(rows.length).toBe(CONCURRENCY);
      rows.forEach((row, i) => {
        expect(row.hasLedger, `employee ${i}`).toBe(true);
        expect(row.days, `employee ${i}`).toBe(i + 1);
      });
    },
    { timeout: 20_000 },
  );
});
