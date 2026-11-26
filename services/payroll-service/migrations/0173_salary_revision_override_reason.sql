-- 0173_salary_revision_override_reason.sql
-- C20 (owner decision 2026-11-26): a revision created with an audited old-basic override carries the reason on the
-- row itself, so the approver sees it. NULL = no override. Additive and idempotent.
-- Rollback: ALTER TABLE payroll.payroll_salary_revisions DROP COLUMN IF EXISTS old_basic_override_reason;
SET lock_timeout = '5s';
ALTER TABLE payroll.payroll_salary_revisions ADD COLUMN IF NOT EXISTS old_basic_override_reason text;
