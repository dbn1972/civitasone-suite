-- DB-L1: Drop single-column indexes made redundant by composite indexes
-- (the composite leading-column covers these use cases).
-- CONCURRENTLY: must be run outside a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS idx_finance_payments_bank_account_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_finance_journals_cost_center_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_finance_journals_legal_entity_id;
