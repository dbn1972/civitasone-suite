-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: finance-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- audit.finance_audit_paras.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_audit_paras_department_id
  ON audit.finance_audit_paras (department_id);

-- treasury.finance_bank_statement.bank_account_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_bank_statement_bank_account_id
  ON treasury.finance_bank_statement (bank_account_id);

-- treasury.finance_bank_statement_lines.match_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_bank_statement_lines_match_id
  ON treasury.finance_bank_statement_lines (match_id);

-- budget.finance_reappropriations.head_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_reappropriations_head_id
  ON budget.finance_reappropriations (head_id);

-- gl.finance_journals.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_journals_legal_entity_id
  ON gl.finance_journals (legal_entity_id);

-- gl.finance_journals.cost_center_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_journals_cost_center_id
  ON gl.finance_journals (cost_center_id);

-- gl.finance_journals.profit_center_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_journals_profit_center_id
  ON gl.finance_journals (profit_center_id);

-- gl.finance_journals.operating_unit_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_journals_operating_unit_id
  ON gl.finance_journals (operating_unit_id);

-- gl.finance_ledger.head_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_ledger_head_id
  ON gl.finance_ledger (head_id);

-- gl.finance_journal_lines.head_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_journal_lines_head_id
  ON gl.finance_journal_lines (head_id);

-- org.legal_entities.parent_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_entities_parent_entity_id
  ON org.legal_entities (parent_entity_id);

-- org.legal_entities.coa_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_entities_coa_id
  ON org.legal_entities (coa_id);

-- org.legal_entities.location_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_entities_location_id
  ON org.legal_entities (location_id);

-- org.operating_units.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operating_units_legal_entity_id
  ON org.operating_units (legal_entity_id);

-- org.operating_units.location_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operating_units_location_id
  ON org.operating_units (location_id);

-- org.cost_centers.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cost_centers_legal_entity_id
  ON org.cost_centers (legal_entity_id);

-- org.cost_centers.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cost_centers_parent_id
  ON org.cost_centers (parent_id);

-- org.cost_centers.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cost_centers_department_id
  ON org.cost_centers (department_id);

-- org.cost_centers.manager_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cost_centers_manager_id
  ON org.cost_centers (manager_id);

-- org.profit_centers.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profit_centers_legal_entity_id
  ON org.profit_centers (legal_entity_id);

-- org.profit_centers.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profit_centers_parent_id
  ON org.profit_centers (parent_id);

-- org.profit_centers.manager_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profit_centers_manager_id
  ON org.profit_centers (manager_id);

-- org.purchasing_orgs.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchasing_orgs_legal_entity_id
  ON org.purchasing_orgs (legal_entity_id);

-- payments.finance_grn_match.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_grn_match_vendor_id
  ON payments.finance_grn_match (vendor_id);

-- payments.finance_payments.bank_account_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_payments_bank_account_id
  ON payments.finance_payments (bank_account_id);

-- payments.finance_payments.reconciled_line_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_payments_reconciled_line_id
  ON payments.finance_payments (reconciled_line_id);

-- treasury.finance_challans.bank_account_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_challans_bank_account_id
  ON treasury.finance_challans (bank_account_id);

-- treasury.finance_challans.reconciled_line_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_challans_reconciled_line_id
  ON treasury.finance_challans (reconciled_line_id);

-- treasury.finance_deposits.source_bill_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_deposits_source_bill_id
  ON treasury.finance_deposits (source_bill_id);

-- treasury.finance_deposit_events.deposit_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_deposit_events_deposit_id
  ON treasury.finance_deposit_events (deposit_id);

-- treasury.finance_deposit_events.journal_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_deposit_events_journal_id
  ON treasury.finance_deposit_events (journal_id);

-- treasury.finance_instruments.bank_account_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_instruments_bank_account_id
  ON treasury.finance_instruments (bank_account_id);

-- treasury.finance_instruments.payment_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_instruments_payment_id
  ON treasury.finance_instruments (payment_id);
