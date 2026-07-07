-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: asset-service

SET lock_timeout = '5s';

-- ============================================================================
-- register.asset_assets.status
-- Valid states: active, disposed, transferred, lost, under_maintenance, scrapped, written_off
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE register.asset_assets
    ADD CONSTRAINT asset_assets_status_check
    CHECK (status IN ('active', 'disposed', 'transferred', 'lost', 'under_maintenance', 'scrapped', 'written_off'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.physical_verifications.status
-- Valid states: draft, submitted, approved (commands.ts: create/submit/approve)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.physical_verifications
    ADD CONSTRAINT physical_verifications_status_check
    CHECK (status IN ('draft', 'submitted', 'approved'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.writeoff_approvals.status
-- Valid states: pending, approved (verification/commands.ts requestWriteoff/approveWriteoff)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.writeoff_approvals
    ADD CONSTRAINT writeoff_approvals_status_check
    CHECK (status IN ('pending', 'approved'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.pending_disposals.workflow_status
-- Valid states: pending, approved, completed, cancelled (enterprise/lifecycle
-- consumers + eoffice-consumer: submit → pending, approve → approved/completed,
-- reject/unable-to-effect → cancelled)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.pending_disposals
    ADD CONSTRAINT pending_disposals_workflow_status_check
    CHECK (workflow_status IN ('pending', 'approved', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- enterprise.project_auc.status (Capital WIP items)
-- Valid states: under_construction, capitalised, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE enterprise.project_auc
    ADD CONSTRAINT project_auc_status_check
    CHECK (status IN ('under_construction', 'capitalised', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- enterprise.asset_leases.status
-- Valid states: active, expired, terminated
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE enterprise.asset_leases
    ADD CONSTRAINT asset_leases_status_check
    CHECK (status IN ('active', 'expired', 'terminated'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- insurance.asset_policies.status
-- Valid states: active, expired, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE insurance.asset_policies
    ADD CONSTRAINT asset_policies_status_check
    CHECK (status IN ('active', 'expired', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- insurance.asset_claims.status
-- Valid states: pending, approved, settled, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE insurance.asset_claims
    ADD CONSTRAINT asset_claims_status_check
    CHECK (status IN ('pending', 'approved', 'settled', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- maintenance.asset_maintenance_plans.status
-- Valid states: active, paused, completed, scheduled (consumer.ts writes
-- "active" on create; "scheduled" observed on pre-existing rows — retained
-- for compatibility)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE maintenance.asset_maintenance_plans
    ADD CONSTRAINT asset_maintenance_plans_status_check
    CHECK (status IN ('active', 'paused', 'completed', 'scheduled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- maintenance.asset_work_orders.status
-- Valid states: open, in_progress, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE maintenance.asset_work_orders
    ADD CONSTRAINT asset_work_orders_status_check
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- depreciation.asset_dep_schedules.status
-- Valid states: active, closed, suspended
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE depreciation.asset_dep_schedules
    ADD CONSTRAINT asset_dep_schedules_status_check
    CHECK (status IN ('active', 'closed', 'suspended'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE register.asset_assets VALIDATE CONSTRAINT asset_assets_status_check;
ALTER TABLE lifecycle.physical_verifications VALIDATE CONSTRAINT physical_verifications_status_check;
ALTER TABLE lifecycle.writeoff_approvals VALIDATE CONSTRAINT writeoff_approvals_status_check;
ALTER TABLE lifecycle.pending_disposals VALIDATE CONSTRAINT pending_disposals_workflow_status_check;
ALTER TABLE enterprise.project_auc VALIDATE CONSTRAINT project_auc_status_check;
ALTER TABLE enterprise.asset_leases VALIDATE CONSTRAINT asset_leases_status_check;
ALTER TABLE insurance.asset_policies VALIDATE CONSTRAINT asset_policies_status_check;
ALTER TABLE insurance.asset_claims VALIDATE CONSTRAINT asset_claims_status_check;
ALTER TABLE maintenance.asset_maintenance_plans VALIDATE CONSTRAINT asset_maintenance_plans_status_check;
ALTER TABLE maintenance.asset_work_orders VALIDATE CONSTRAINT asset_work_orders_status_check;
ALTER TABLE depreciation.asset_dep_schedules VALIDATE CONSTRAINT asset_dep_schedules_status_check;
