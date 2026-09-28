-- 0022_cycle_counts_status_chk_fix.sql
--
-- Purpose: 0011's cycle_counts_status_chk CHECK constraint allows only
-- ('pending', 'approved', 'rejected', 'auto_adjusted') -- but domain.ts's
-- evaluateCycleCount() (the ONLY code that computes a new row's status) can
-- only ever produce 'auto_posted' or 'pending_approval', NEITHER of which the
-- constraint allows. Every single cycle-count create failed with a real
-- Postgres CHECK-constraint violation, for every tenant, regardless of
-- variance -- confirmed live via the queue's own DLQ before this fix
-- (see tests/cycle-count-lifecycle.integration.test.ts's first describe
-- block, which reproduces it against the pre-fix constraint).
--
-- Widens the constraint to the vocabulary domain.ts/validators.ts/the
-- consumer's own approve+reject WHERE-clause preconditions already agree on:
--   pending | auto_posted | pending_approval | approved | rejected
-- 'auto_adjusted' (0011's term) is dropped, not kept alongside the others:
-- grepped every migration and every src/tests file in this service -- 0011 is
-- the only migration that ever touches this constraint, and 'auto_adjusted'
-- is not referenced anywhere else, so no row can exist with that status to
-- migrate or preserve compatibility for.
--
-- Table is empty in every environment this migration can run against (bug
-- above means no row has ever been successfully inserted), so a plain
-- DROP + ADD validates instantly; no NOT VALID/VALIDATE split needed.
--
-- Rollback: re-add 0011's original constraint (only safe if no row currently
-- has status 'auto_posted' or 'pending_approval').

SET lock_timeout = '5s';

ALTER TABLE inventory.cycle_counts DROP CONSTRAINT IF EXISTS cycle_counts_status_chk;
ALTER TABLE inventory.cycle_counts
  ADD CONSTRAINT cycle_counts_status_chk
  CHECK (status IN ('pending', 'auto_posted', 'pending_approval', 'approved', 'rejected'));
