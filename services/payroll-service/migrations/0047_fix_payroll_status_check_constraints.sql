-- 0047_fix_payroll_status_check_constraints.sql
--
-- CRITICAL fix: the CHECK constraints on payroll.payroll_slips.status and
-- payroll.payroll_runs.status do not match what the application actually
-- writes, and the payroll_slips one throws INSIDE the run's processing
-- transaction -- taking down the WHOLE payroll run, not just one employee's
-- slip.
--
-- Proof: seeding an employee whose fixed/statutory deductions exceed gross
-- (heavy loan/court-order/LOP deductions) inside an otherwise-normal run
-- makes the run reach terminal status 'failed', with
-- payroll_runs.last_error (migration 0046) containing the literal text:
--   new row for relation "payroll_slips" violates check constraint
--   "payroll_slips_status_check"
--
-- ============================================================================
-- 1) payroll.payroll_slips.status
-- ============================================================================
-- consumer.ts writes, for every slip (both the salaried path in
-- computeAndInsertSlip and the pensioner path inside registerPayrollConsumers):
--   status: result.negativeNet ? "exception" : "computed"
--   status: result.netPayMinor < 0n ? "exception" : "computed"
-- domain.ts's negativeNet is deliberately NOT floor-protected (unlike the
-- RECOVERY_CODES set -- LOP/LOAN_EMI/ARREAR_RECOVERY -- which the protected-
-- net floor caps/defers instead of letting go negative): it fires exactly
-- when a FIXED, non-recovery deduction (e.g. a court-ordered recovery, or any
-- other structure-defined deduction) alone exceeds gross -- flagged as an
-- exception for manual review, by design. Migration 0027's
-- payroll_slips_status_check only allows ('computed','approved','paid','held')
-- -- 'exception' is missing, so that INSERT throws and aborts every other
-- employee's already-computed slip in the same transaction along with it.
-- Real payrolls routinely have employees with heavy deductions; this is not
-- an edge case.
--
-- Fix: add 'exception'. ('approved' and 'held' are kept even though nothing
-- currently writes them -- pre-existing, intentional forward allowance for
-- the manual slip-review workflow 'exception' feeds; out of scope here.)
--
-- ============================================================================
-- 2) payroll.payroll_runs.status
-- ============================================================================
-- Two CHECK constraints exist on the same column, and Postgres enforces
-- their INTERSECTION:
--   - payroll_runs_status_check -- an unnamed inline CHECK on the column in
--     0001_init.sql; Postgres auto-derives the name <table>_<column>_check
--     for an unnamed column constraint, which is why this pre-existing
--     constraint already happens to be called exactly that:
--       CHECK (status IN ('draft','processing','approved','disbursed','failed'))   -- 5 values
--   - payroll_runs_status_check_extended -- migration 0027, additive:
--       CHECK (status IN ('draft','processing','computed','approved',
--                         'disbursed','paid','cancelled','failed'))               -- 8 values
-- The intersection is just the original 5 -- 'computed', 'paid', and
-- 'cancelled' are silently rejected despite 0027's evident intent to allow
-- them.
--
-- Exhaustive grep of every `status:` literal written to payroll_runs
-- anywhere in the repo (consumer.ts's registerPayrollConsumers is the only
-- writer: runCreate -> "processing", the runCreate catch -> "failed",
-- runApprove -> "approved", runDisburse -> "disbursed", runRevert ->
-- "draft") confirms today's writers are a strict subset of the extended
-- constraint's 8 values. Dropping the redundant older constraint and keeping
-- only the extended one is therefore a pure widening -- no behavior change
-- for any status the code writes today -- while unblocking computed/paid/
-- cancelled for the run-completion/payment/cancellation paths those three
-- already-allowed values exist for.
--
-- Fix: drop the redundant older payroll_runs_status_check so
-- payroll_runs_status_check_extended is the sole, authoritative constraint.
--
-- ============================================================================
-- Rollback
-- ============================================================================
--   ALTER TABLE payroll.payroll_slips DROP CONSTRAINT IF EXISTS payroll_slips_status_check;
--   ALTER TABLE payroll.payroll_slips ADD CONSTRAINT payroll_slips_status_check
--     CHECK (status IN ('computed', 'approved', 'paid', 'held'));
--   ALTER TABLE payroll.payroll_runs ADD CONSTRAINT payroll_runs_status_check
--     CHECK (status IN ('draft','processing','approved','disbursed','failed'));

SET lock_timeout = '5s';

-- ---- payroll.payroll_slips.status: add 'exception' -------------------------
ALTER TABLE payroll.payroll_slips
  DROP CONSTRAINT IF EXISTS payroll_slips_status_check;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_slips
    ADD CONSTRAINT payroll_slips_status_check
    CHECK (status IN ('computed', 'approved', 'paid', 'held', 'exception'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.payroll_slips
  VALIDATE CONSTRAINT payroll_slips_status_check;

-- ---- payroll.payroll_runs.status: drop the redundant older constraint -----
-- payroll_runs_status_check_extended (0027) already covers every value this
-- one does, plus computed/paid/cancelled -- nothing further to validate.
ALTER TABLE payroll.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
