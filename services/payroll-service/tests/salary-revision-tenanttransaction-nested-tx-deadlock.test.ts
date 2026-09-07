/**
 * payroll-service nested-transaction connection-pool deadlock regression,
 * tenantTransaction re-audit batch, RAW-QUERY variant.
 *
 * resolveLatestRevision (and its siblings resolveDeclaration,
 * resolveTdsYtdMinor, and the in-loop call to resolvePtSlabs -- all in
 * payroll/consumer.ts) ran a bare db.execute(sql`...`) against the
 * pool-level db object, called once per employee from processPayrollRun
 * own already-open outer db.transaction(async (tx) => {...}). This is a
 * DIFFERENT shape from the scopedRead()/db.transaction()-wrapper pattern
 * the scan_nested_tx_v2.py scanner (and this same re-audit batch elsewhere)
 * looks for: it never opens a nested transaction, but a bare db.execute()
 * still checks out a SEPARATE connection from the same finite pool instead
 * of riding the caller already-open transaction connection -- the identical
 * circular-wait deadlock once concurrency reaches pool.max (10), just
 * reached via a raw query instead of a transaction wrapper. Found by
 * independent review of PR #1077 (the getLopForMonth fix in this same
 * audit batch), which caught that the fix there did not cover this
 * sibling danger a few lines away in the same function/transaction.
 *
 * Fixed by adding a tx: typeof db parameter to resolveLatestRevision,
 * resolveDeclaration, resolveTdsYtdMinor and resolvePtSlabs, reading
 * through tx.execute() instead of db.execute(); the pre-loop call sites
 * (which run before the transaction opens) pass db itself, the in-loop
 * call sites pass the outer transaction tx.
 *
 * This test exercises resolveLatestRevision (exported for direct testing,
 * matching the getLopForMonth test in this same PR) as the representative
 * case for this bug shape, at pool.max + 3 concurrency, real Postgres,
 * real pool.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { resolveLatestRevision } from "../src/modules/payroll/consumer.js";

const TENANT = "90000000-dead-4000-8000-00000000c0de";
const CONCURRENCY = 13;
const MONTH = "2026-09";

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.payroll_salary_revisions WHERE tenant_id = ${TENANT}::uuid`);
  }));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("payroll processPayrollRun -- nested-transaction pool-exhaustion deadlock, raw db.execute variant (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent outer transactions each calling resolveLatestRevision (the real processPayrollRun call shape) drain without deadlocking the connection pool`,
    async () => {
      const employeeIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

      await runWithTenant(TENANT, () => db.transaction(async (tx) => {
        for (let i = 0; i < employeeIds.length; i++) {
          await tx.execute(sql`
            INSERT INTO payroll.payroll_salary_revisions
              (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor)
            VALUES (${TENANT}::uuid, ${employeeIds[i]}::uuid, ${MONTH + "-01"}::date, 5000000, ${5000000 + (i + 1) * 100000}, 8000000, ${8000000 + (i + 1) * 100000})
          `);
        }
      }));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      const results = await Promise.race([
        Promise.all(employeeIds.map((employeeId) =>
          runWithTenant(TENANT, () => db.transaction(async (tx) => {
            // Exactly the call shape used by processPayrollRun (consumer.ts):
            // an already-open outer db.transaction calling the tx-scoped
            // helper with its own tx, once per employee.
            return resolveLatestRevision(tx as unknown as typeof db, TENANT, employeeId, MONTH);
          })),
        )),
        new Promise<null>((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `did not complete within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      const rows = results as Array<{ newBasicMinor: bigint; effectiveDate: string } | null>;
      expect(rows.length).toBe(CONCURRENCY);
      rows.forEach((row, i) => {
        expect(row, `employee ${i}`).not.toBeNull();
        expect(row!.newBasicMinor, `employee ${i}`).toBe(BigInt(5000000 + (i + 1) * 100000));
      });
    },
    { timeout: 20_000 },
  );
});
