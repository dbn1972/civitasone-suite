import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { clearRunRegister } from "./register.js";

type Tx = Pick<typeof db, "execute">;

export interface RunUnwindSummary {
  statutoryRows: Record<"pf" | "esi" | "nps" | "gpf" | "tds", number>;
  loanRepayments: number;
  loansRestored: number;
  arrearsReleased: number;
  bonusesReleased: number;
  reimbursementsReleased: number;
}

const LEDGERS = ["pf", "esi", "nps", "gpf", "tds"] as const;

const count = (rows: unknown): number => (Array.isArray(rows) ? rows.length : Array.from(rows as Iterable<unknown>).length);

/**
 * UAT L2-N3 review (send back a computed run): a run moved computed -> failed
 * must leave its period as if it had never been computed, so that a new run for
 * the period pays every employee exactly once. A computation pass writes all of
 * the following in ONE transaction; this reverses each of them inside the
 * caller transaction, which holds the run row lock:
 *  - statutory ledger rows (PF / ESI / NPS / GPF / TDS) of the run: deleted;
 *  - loan EMI repayments the run recorded: deleted, and their principal is put
 *    back on the loan outstanding (a loan the run closed is open again);
 *  - arrears, bonus and reimbursements the run consumed: released (marker
 *    cleared). An arrear goes back to "approved" when it is a revision arrear or
 *    the tenant requires arrears approval (it could only have been paid
 *    approved), otherwise to "pending" (approval off: still payable);
 *  - department register rows: deleted;
 *  - employee claims (payroll_run_employee_claims): released by the
 *    trg_release_run_claims trigger when the status becomes failed.
 * The slips stay on the failed run as the record of what was computed and why it
 * was sent back. Pure SQL, tenant scoped (FORCE RLS), idempotent.
 */
export async function unwindRunComputationTx(tx: Tx, tenantId: string, runId: string): Promise<RunUnwindSummary> {
  const statutoryRows = { pf: 0, esi: 0, nps: 0, gpf: 0, tds: 0 };
  for (const k of LEDGERS) {
    statutoryRows[k] = count(await tx.execute(sql`DELETE FROM ${sql.raw(`statutory.payroll_${k}`)}
      WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid RETURNING 1`));
  }

  const repayments = Array.from((await tx.execute(sql`
    DELETE FROM loans.payroll_loan_repayments
     WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid
    RETURNING loan_id::text AS loan_id, principal_minor::text AS principal_minor
  `)) as unknown as Iterable<{ loan_id: string; principal_minor: string }>);
  const principalByLoan = new Map<string, bigint>();
  for (const r of repayments) principalByLoan.set(r.loan_id, (principalByLoan.get(r.loan_id) ?? 0n) + BigInt(r.principal_minor));
  for (const [loanId, principal] of principalByLoan) {
    await tx.execute(sql`
      UPDATE loans.payroll_loans
         SET outstanding_minor = outstanding_minor + ${principal.toString()}::bigint,
             status = CASE WHEN status = ${"closed"} THEN ${"disbursed"} ELSE status END,
             updated_at = NOW()
       WHERE id = ${loanId}::uuid AND tenant_id = ${tenantId}::uuid
    `);
  }

  const arrearsReleased = count(await tx.execute(sql`
    UPDATE payroll.payroll_arrears a
       SET run_id = NULL,
           status = CASE
             WHEN a.source IN (${"revision"}, ${"revision_dmd"})
               OR COALESCE((SELECT s.arrears_approval_required FROM payroll.payroll_settings s WHERE s.tenant_id = a.tenant_id), true)
             THEN ${"approved"} ELSE ${"pending"} END
     WHERE a.tenant_id = ${tenantId}::uuid AND a.run_id = ${runId}::uuid AND a.status = ${"paid"}
    RETURNING 1
  `));
  const bonusesReleased = count(await tx.execute(sql`
    UPDATE payroll.payroll_bonus SET status = ${"approved"}, paid_in_run_id = NULL
     WHERE tenant_id = ${tenantId}::uuid AND paid_in_run_id = ${runId}::uuid RETURNING 1
  `));
  const reimbursementsReleased = count(await tx.execute(sql`
    UPDATE payroll.payroll_reimbursements SET status = ${"approved"}, paid_in_run_id = NULL
     WHERE tenant_id = ${tenantId}::uuid AND paid_in_run_id = ${runId}::uuid RETURNING 1
  `));

  await clearRunRegister(tx as unknown as typeof db, tenantId, runId);

  return {
    statutoryRows,
    loanRepayments: repayments.length,
    loansRestored: principalByLoan.size,
    arrearsReleased, bonusesReleased, reimbursementsReleased,
  };
}
