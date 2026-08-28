-- Migration: 0024_fix_case_status_check_drift
-- Purpose: Replace cases.legal_cases.legal_cases_status_check with the
--   constraint 0011_check_constraints_status_columns.sql was actually
--   trying to add.
--
--   Root cause, found while verifying the fix for the caseDispose
--   disposition bug (0023_case_disposition.sql): on the shared dev DB, a
--   constraint under this exact name already existed BEFORE 0011 ran, with
--   a value list from a completely different status vocabulary --
--     pending, hearing, reserved, decided, appealed, closed
--   -- of unknown origin: not present in any migration file in this repo,
--   and not present in any infra/db/bootstrap/*.sql script either.
--   (0001_init.sql's own CREATE TABLE for cases.legal_cases already
--   declares a *differently-named* constraint, chk_legal_case_status, with
--   the correct vocabulary -- so this was never a case of "no constraint
--   existed"; it's two same-column constraints under two different names,
--   where the second one to be added, legal_cases_status_check, ended up
--   wrong. Postgres ANDs multiple CHECK constraints on the same column, so
--   chk_legal_case_status alone being correct did not help: a row must
--   satisfy every applicable constraint, and this second, wrongly-defined
--   one alone was sufficient to reject "disposed" outright.) 0011's ADD
--   CONSTRAINT is wrapped in `EXCEPTION WHEN duplicate_object THEN NULL`,
--   which is the right pattern for a constraint that's already correct --
--   but here it silently preserved a constraint that was already WRONG,
--   because the name collided. The application has only ever used the
--   intended vocabulary (validators.ts's listCasesQuery status enum:
--   pending, disposed, appealed, stayed, settled; cases/domain.ts's
--   assertCanDispose transitions status to "disposed"), so this has
--   apparently made every real dispose attempt against this DB fail with
--   `new row for relation "legal_cases" violates check constraint
--   "legal_cases_status_check"` since the day this second constraint was
--   added -- confirmed live: caseDispose sent straight to the (in dev,
--   MemoryQueue) DLQ, case status left at "pending", disposition text
--   never even reaching the point where it would have been discarded by
--   the separate bug 0023 fixes.
--
--   After this migration, chk_legal_case_status and legal_cases_status_check
--   are two identically-defined, redundant constraints on the same column.
--   Left both in place rather than dropping either: chk_legal_case_status
--   predates migration tracking entirely (dropping it is a bigger,
--   separate decision than this fix), and legal_cases_status_check is the
--   name every sibling table's status constraint in 0011 uses, which
--   tooling/tests may reasonably expect to find by that name.
--
--   Checked directly against the shared dev DB before writing this file
--   (scoped per-tenant, across every known tenant, since these tables
--   carry FORCE ROW LEVEL SECURITY): every existing row's status is
--   "pending" -- nothing currently relies on the wrong constraint's
--   extra values, consistent with no application code ever writing them.
--   Still using NOT VALID + a separate VALIDATE (rather than a plain ADD
--   CONSTRAINT) to stay safe on any other environment this replays
--   against, per this repo's established pattern for constraint changes.
--
--   Idempotent: DROP CONSTRAINT IF EXISTS then re-add is safe to re-run,
--   and safe on a fresh container where the constraint was never wrong to
--   begin with (0011 already added the correct one there in one pass).
-- Rollback: cannot restore the exact prior (wrong) constraint definition;
--   to revert to no constraint at all:
--   ALTER TABLE cases.legal_cases DROP CONSTRAINT IF EXISTS legal_cases_status_check;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE cases.legal_cases
  DROP CONSTRAINT IF EXISTS legal_cases_status_check;

ALTER TABLE cases.legal_cases
  ADD CONSTRAINT legal_cases_status_check
  CHECK (status IN ('pending', 'disposed', 'appealed', 'stayed', 'settled'))
  NOT VALID;

ALTER TABLE cases.legal_cases
  VALIDATE CONSTRAINT legal_cases_status_check;
