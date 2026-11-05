import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { clearRunRegister } from "./register.js";
import { deleteLedgerRowsForRunTx, type RemovedLedgerRow } from "../statutory/repo.js";

type Tx = Pick<typeof db, "execute">;
type Rows<T> = T[];
const rowsOf = <T>(r: unknown): Rows<T> => Array.from(r as Iterable<T>);

/** Amounts are paise digit strings; ids only, no names (no PII). */
export type UnwoundLoanRepayment = { id: string; loanId: string; employeeId: string | null; installmentNo: number; principalMinor: string; interestMinor: string; totalMinor: string };
export type RestoredLoan = { loanId: string; outstandingBeforeMinor: string; outstandingAfterMinor: string; statusBefore: string; statusAfter: string };
export type UnwoundArrear = { id: string; employeeId: string; componentCode: string; fromPeriod: string; toPeriod: string; source: string; oldAmountMinor: string; newAmountMinor: string; differenceMinor: string; pensionBaseMinor: string | null; settledInPeriod: string | null; statusAfter?: string };
export type ReleasedEarning = { id: string; employeeId: string; amountMinor: string };

export interface RunUnwind {
  counts: {
    statutoryRows: number; loanRepayments: number; loansRestored: number;
    arrearsDeleted: number; arrearsReleased: number; bonusesReleased: number; reimbursementsReleased: number;
  };
  statutoryRows: RemovedLedgerRow[];
  loanRepayments: UnwoundLoanRepayment[];
  loans: RestoredLoan[];
  /** revision_dmd arrears this pass generated for its own month: deleted (the next pass re-derives them). */
  arrearsDeleted: UnwoundArrear[];
  /** Other arrears the pass consumed (manual, revision, earlier dmd): released. */
  arrearsReleased: UnwoundArrear[];
  bonusesReleased: ReleasedEarning[];
  reimbursementsReleased: ReleasedEarning[];
}

const ARREAR_COLS = sql.raw(`id::text AS id, employee_id::text AS "employeeId", component_code AS "componentCode", from_period AS "fromPeriod", to_period AS "toPeriod", source, old_amount_minor::text AS "oldAmountMinor", new_amount_minor::text AS "newAmountMinor", difference_minor::text AS "differenceMinor", pension_base_minor::text AS "pensionBaseMinor", settled_in_period AS "settledInPeriod"`);

/**
 * UAT L2-N3 review (send back a computed run): a run moved computed -> failed
 * must leave its period as if it had never been computed, so that a new run for
 * the period pays every employee exactly once and re-derives everything it
 * derived. A computation pass writes all of the following in ONE transaction;
 * this reverses each of them inside the caller transaction (which holds the run
 * row lock) and RETURNS every affected row, so the reversal can be rebuilt from
 * the audit trail (the #2449 RETURNING pattern):
 *  - statutory ledger rows (PF / ESI / NPS / GPF / TDS) of the run: deleted;
 *  - loan EMI repayments the run recorded: deleted, and their principal is put
 *    back on the loan outstanding (a loan the run closed is open again);
 *  - due-minus-drawn arrears (source revision_dmd) the pass GENERATED for its
 *    own month: deleted. Releasing them would make the next pass treat them as
 *    already raised, price only the difference and lose it to the unique key
 *    (ON CONFLICT DO NOTHING), so a corrected revision or DA rate would be paid
 *    at the stale amount (PR #2454 delta review);
 *  - every other arrear the run consumed (manual, revision, a dmd row raised by
 *    an earlier month): released. It goes back to "approved" when it is a
 *    revision arrear or the tenant requires arrears approval (it could only
 *    have been paid approved), otherwise to "pending" (approval off: payable);
 *  - bonus and reimbursements the run consumed: released (back to approved);
 *  - department register rows: deleted;
 *  - employee claims (payroll_run_employee_claims): released by the
 *    trg_release_run_claims trigger when the status becomes failed.
 * The slips stay on the failed run as the record of what was computed and why
 * it was sent back. Tenant scoped (FORCE RLS); idempotent.
 */
export async function unwindRunComputationTx(tx: Tx, run: { id: string; tenantId: string; month: string }): Promise<RunUnwind> {
  const { id: runId, tenantId, month } = run;

  const statutory = await deleteLedgerRowsForRunTx(tx, runId, tenantId);

  const loanRepayments = rowsOf<UnwoundLoanRepayment>(await tx.execute(sql`
    DELETE FROM loans.payroll_loan_repayments r
     WHERE r.tenant_id = ${tenantId}::uuid AND r.run_id = ${runId}::uuid
    RETURNING r.id::text AS id, r.loan_id::text AS "loanId",
              (SELECT l.employee_id::text FROM loans.payroll_loans l WHERE l.id = r.loan_id) AS "employeeId",
              r.installment_no AS "installmentNo", r.principal_minor::text AS "principalMinor",
              r.interest_minor::text AS "interestMinor", r.total_minor::text AS "totalMinor"
  `));
  const principalByLoan = new Map<string, bigint>();
  for (const r of loanRepayments) principalByLoan.set(r.loanId, (principalByLoan.get(r.loanId) ?? 0n) + BigInt(r.principalMinor));
  const loans: RestoredLoan[] = [];
  for (const [loanId, principal] of principalByLoan) {
    const before = rowsOf<{ outstanding: string; status: string }>(await tx.execute(sql`
      SELECT outstanding_minor::text AS outstanding, status FROM loans.payroll_loans
       WHERE id = ${loanId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`))[0];
    const after = rowsOf<{ outstanding: string; status: string }>(await tx.execute(sql`
      UPDATE loans.payroll_loans
         SET outstanding_minor = outstanding_minor + ${principal.toString()}::bigint,
             status = CASE WHEN status = ${"closed"} THEN ${"disbursed"} ELSE status END,
             updated_at = NOW()
       WHERE id = ${loanId}::uuid AND tenant_id = ${tenantId}::uuid
      RETURNING outstanding_minor::text AS outstanding, status`))[0];
    if (before && after) {
      loans.push({ loanId, outstandingBeforeMinor: before.outstanding, outstandingAfterMinor: after.outstanding, statusBefore: before.status, statusAfter: after.status });
    }
  }

  const arrearsDeleted = rowsOf<UnwoundArrear>(await tx.execute(sql`
    DELETE FROM payroll.payroll_arrears
     WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid
       AND source = ${"revision_dmd"} AND settled_in_period = ${month}
    RETURNING ${ARREAR_COLS}
  `));
  const arrearsReleased = rowsOf<UnwoundArrear>(await tx.execute(sql`
    UPDATE payroll.payroll_arrears a
       SET run_id = NULL,
           status = CASE
             WHEN a.source IN (${"revision"}, ${"revision_dmd"})
               OR COALESCE((SELECT s.arrears_approval_required FROM payroll.payroll_settings s WHERE s.tenant_id = a.tenant_id), true)
             THEN ${"approved"} ELSE ${"pending"} END
     WHERE a.tenant_id = ${tenantId}::uuid AND a.run_id = ${runId}::uuid AND a.status = ${"paid"}
    RETURNING ${ARREAR_COLS}, a.status AS "statusAfter"
  `));
  const bonusesReleased = rowsOf<ReleasedEarning>(await tx.execute(sql`
    UPDATE payroll.payroll_bonus SET status = ${"approved"}, paid_in_run_id = NULL
     WHERE tenant_id = ${tenantId}::uuid AND paid_in_run_id = ${runId}::uuid
    RETURNING id::text AS id, employee_id::text AS "employeeId", bonus_amount_minor::text AS "amountMinor"
  `));
  const reimbursementsReleased = rowsOf<ReleasedEarning>(await tx.execute(sql`
    UPDATE payroll.payroll_reimbursements SET status = ${"approved"}, paid_in_run_id = NULL
     WHERE tenant_id = ${tenantId}::uuid AND paid_in_run_id = ${runId}::uuid
    RETURNING id::text AS id, employee_id::text AS "employeeId", amount_minor::text AS "amountMinor"
  `));

  await clearRunRegister(tx as unknown as typeof db, tenantId, runId);

  return {
    counts: {
      statutoryRows: statutory.rows.length, loanRepayments: loanRepayments.length, loansRestored: loans.length,
      arrearsDeleted: arrearsDeleted.length, arrearsReleased: arrearsReleased.length,
      bonusesReleased: bonusesReleased.length, reimbursementsReleased: reimbursementsReleased.length,
    },
    statutoryRows: statutory.rows,
    loanRepayments, loans, arrearsDeleted, arrearsReleased, bonusesReleased, reimbursementsReleased,
  };
}
