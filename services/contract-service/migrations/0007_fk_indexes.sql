-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: contract-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- contracts.contract_contracts.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_contracts_vendor_id
  ON contracts.contract_contracts (vendor_id);

-- contracts.contract_milestones.contract_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_milestones_contract_id
  ON contracts.contract_milestones (contract_id);

-- rate.contract_rate_contracts.vendor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_rate_contracts_vendor_id
  ON rate.contract_rate_contracts (vendor_id);
