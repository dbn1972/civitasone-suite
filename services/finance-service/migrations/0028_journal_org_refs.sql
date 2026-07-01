-- 0028: Add legal_entity_id, cost_center_id, profit_center_id to finance_journals.
-- Every financial transaction must post against a legal entity (for statutory books)
-- and optionally a cost center (for management accounting) / profit center (for P&L).
-- Additive, idempotent.

ALTER TABLE gl.finance_journals
  ADD COLUMN IF NOT EXISTS legal_entity_id  UUID,
  ADD COLUMN IF NOT EXISTS cost_center_id   UUID,
  ADD COLUMN IF NOT EXISTS profit_center_id UUID,
  ADD COLUMN IF NOT EXISTS operating_unit_id UUID;

CREATE INDEX IF NOT EXISTS idx_journal_le ON gl.finance_journals (tenant_id, legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_journal_cc ON gl.finance_journals (tenant_id, cost_center_id);

COMMENT ON COLUMN gl.finance_journals.legal_entity_id IS 'Which legal entity (company code) this transaction belongs to';
COMMENT ON COLUMN gl.finance_journals.cost_center_id IS 'Cost allocation point (WHERE money is spent)';
COMMENT ON COLUMN gl.finance_journals.profit_center_id IS 'P&L responsibility (WHO owns the outcome)';
COMMENT ON COLUMN gl.finance_journals.operating_unit_id IS 'Which branch/plant originated this transaction';
