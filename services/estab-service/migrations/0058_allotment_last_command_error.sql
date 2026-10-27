-- GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01 (UAT B4): surface why a lifecycle command was refused.
-- The quarters consumer used to swallow a refused command (maker-checker, illegal transition, stale
-- version), so the officer saw the status simply not change. A refusal is now recorded on the
-- allotment: a machine code (never a raw message; the web maps it to localised copy), the command
-- that was refused and when. Cleared by the next applied transition.
-- Additive and idempotent. Rollback:
--   ALTER TABLE quarters.estab_quarter_allotments
--     DROP COLUMN IF EXISTS last_command_error_code,
--     DROP COLUMN IF EXISTS last_command_error_command,
--     DROP COLUMN IF EXISTS last_command_error_at;
ALTER TABLE quarters.estab_quarter_allotments
  ADD COLUMN IF NOT EXISTS last_command_error_code    varchar(48),
  ADD COLUMN IF NOT EXISTS last_command_error_command varchar(24),
  ADD COLUMN IF NOT EXISTS last_command_error_at      timestamptz;
