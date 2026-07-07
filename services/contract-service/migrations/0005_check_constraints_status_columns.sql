-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: contract-service

SET lock_timeout = '5s';

-- ============================================================================
-- contracts.contract_contracts.status
-- Valid states from domain.ts + init migration + eOffice approval loop:
-- draft, pending_approval, approved, active, closed, terminated, expired,
-- renewed, suspended
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE contracts.contract_contracts
    ADD CONSTRAINT contract_contracts_status_check
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'active', 'closed', 'terminated', 'expired', 'renewed', 'suspended'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- contracts.contract_milestones.status
-- Valid states: pending, completed, completed_late, overdue, cancelled
-- (routes.ts marks on-time completion "completed", late completion
-- "completed_late" — not "achieved")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE contracts.contract_milestones
    ADD CONSTRAINT contract_milestones_status_check
    CHECK (status IN ('pending', 'completed', 'completed_late', 'overdue', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- rate.contract_rate_contracts.status
-- Valid states: active, expired, terminated
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rate.contract_rate_contracts
    ADD CONSTRAINT contract_rate_contracts_status_check
    CHECK (status IN ('active', 'expired', 'terminated'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE contracts.contract_contracts VALIDATE CONSTRAINT contract_contracts_status_check;
ALTER TABLE contracts.contract_milestones VALIDATE CONSTRAINT contract_milestones_status_check;
ALTER TABLE rate.contract_rate_contracts VALIDATE CONSTRAINT contract_rate_contracts_status_check;
