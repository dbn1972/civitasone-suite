-- 0018: Add legal_entity_id to payroll_runs.
-- Cross-service reference to finance org.legal_entities. Determines which
-- company's books the salary GL journal posts to. Additive + idempotent.

ALTER TABLE payroll.payroll_runs
  ADD COLUMN IF NOT EXISTS legal_entity_id UUID;

COMMENT ON COLUMN payroll.payroll_runs.legal_entity_id IS
  'Cross-service reference to finance org.legal_entities. Propagates to GL journal.';

CREATE INDEX IF NOT EXISTS idx_payroll_runs_le
  ON payroll.payroll_runs (tenant_id, legal_entity_id);
