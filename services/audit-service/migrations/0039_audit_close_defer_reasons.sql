-- Purpose: persist the reasons captured by the new investigation close, plan defer and risk close operations
--   (GAP-AUDIT-INVESTIGATION-05, GAP-AUDIT-PLAN-05, GAP-AUDIT-RISK-REGISTER-04). Additive, nullable, idempotent; no backfill
--   (earlier closures/deferrals never recorded a reason).
-- Rollback: ALTER TABLE investigation.investigations DROP COLUMN IF EXISTS close_outcome, DROP COLUMN IF EXISTS close_reason,
--   DROP COLUMN IF EXISTS closed_at; ALTER TABLE plan.audit_plans DROP COLUMN IF EXISTS defer_reason;
--   ALTER TABLE risk.audit_risks DROP COLUMN IF EXISTS close_reason;
-- Affected services: audit-service
ALTER TABLE investigation.investigations ADD COLUMN IF NOT EXISTS close_outcome varchar(24);
ALTER TABLE investigation.investigations ADD COLUMN IF NOT EXISTS close_reason  text;
ALTER TABLE investigation.investigations ADD COLUMN IF NOT EXISTS closed_at     timestamptz;
ALTER TABLE plan.audit_plans ADD COLUMN IF NOT EXISTS defer_reason text;
ALTER TABLE risk.audit_risks ADD COLUMN IF NOT EXISTS close_reason text;

DO $$ BEGIN
  ALTER TABLE investigation.investigations
    ADD CONSTRAINT investigations_close_outcome_check
    CHECK (close_outcome IS NULL OR close_outcome IN ('substantiated', 'unsubstantiated', 'inconclusive', 'referred'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
