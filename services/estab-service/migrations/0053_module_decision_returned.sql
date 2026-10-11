-- Migration: 0053_module_decision_returned.sql
-- Purpose: SmartTransfer OS (ST-M01-16). Surface the eOffice RETURN outcome on
--          the module decision callback log, and persist the machine-readable
--          reason for a decision.
--          (1) widen files.module_decision_log.decision CHECK to include
--              'returned' (0007 shipped it as ('approved','rejected') only);
--          (2) add a nullable reason_code column (reason for reject/return).
--          Governing (PROPOSED) decision: D-ST-08 option (a) — approvals flow
--          via the eOffice linkage with new SmartTransfer callback types.
--          Does NOT touch the workflow engine ref_type CHECK (that is the
--          D-ST-08-gated change and remains unapproved).
-- Idempotent; safe to re-run. Affected service: estab-service (files/linkage).
-- Rollback:
--   ALTER TABLE files.module_decision_log DROP COLUMN IF EXISTS reason_code;
--   ALTER TABLE files.module_decision_log DROP CONSTRAINT IF EXISTS module_decision_log_decision_check;
--   ALTER TABLE files.module_decision_log
--     ADD CONSTRAINT module_decision_log_decision_check
--     CHECK (decision IN ('approved', 'rejected'));

SET lock_timeout = '5s';

-- (1) Widen the decision CHECK. 0007 created it inline, so Postgres named it
--     <table>_<column>_check. Drop that and recreate with 'returned' added.
ALTER TABLE files.module_decision_log
  DROP CONSTRAINT IF EXISTS module_decision_log_decision_check;
ALTER TABLE files.module_decision_log
  ADD CONSTRAINT module_decision_log_decision_check
  CHECK (decision IN ('approved', 'rejected', 'returned'));

-- (2) Reason for the outcome (why a file was rejected or returned). Nullable;
--     approvals typically carry none. Machine-readable code, no free PII.
ALTER TABLE files.module_decision_log
  ADD COLUMN IF NOT EXISTS reason_code TEXT;
