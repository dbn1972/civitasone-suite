-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0005_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: contract-service

SET lock_timeout = '5s';

-- ============================================================================
-- NOTE: contracts.contract_contracts.status — already constrained by
-- contract_contracts_status_check (0005) covering ('draft',
-- 'pending_approval', 'approved', 'active', 'closed', 'terminated',
-- 'expired', 'renewed', 'suspended'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: contracts.contract_milestones.status — already constrained by
-- contract_milestones_status_check (0005) covering ('pending', 'completed',
-- 'completed_late', 'overdue', 'cancelled'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: rate.contract_rate_contracts.status — already constrained by
-- contract_rate_contracts_status_check (0005) covering ('active', 'expired',
-- 'terminated'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: contracts.contract_amendments has no status/type column. The
-- amendment_no is an integer counter, not a state. Nothing to add.
-- ============================================================================

-- No additional constraints needed — all status/type columns in this service
-- were fully covered by migration 0005_check_constraints_status_columns.sql.
-- This file exists for audit completeness and to confirm all columns have been
-- reviewed as part of the cross-service status-constraint sweep (task 6.4).
