-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: audit-service

SET lock_timeout = '5s';

-- ============================================================================
-- exports.exports.status
-- Valid states: pending, processing, completed, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE exports.exports
    ADD CONSTRAINT exports_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- plan.audit_plans.status
-- Valid states: draft, in_progress, completed, deferred
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE plan.audit_plans
    ADD CONSTRAINT audit_plans_status_check
    CHECK (status IN ('draft', 'in_progress', 'completed', 'deferred'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- plan.audit_plan_items.status
-- Valid states: scheduled, in_progress, completed, deferred
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE plan.audit_plan_items
    ADD CONSTRAINT audit_plan_items_status_check
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'deferred'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- observation.audit_observations.status
-- Valid states from domain.ts OBSERVATION_STATUSES:
-- open, replied, replied_rejected, para_drafted, compliance_pending, partially_closed, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE observation.audit_observations
    ADD CONSTRAINT audit_observations_status_check
    CHECK (status IN ('open', 'replied', 'replied_rejected', 'para_drafted', 'compliance_pending', 'partially_closed', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- para.audit_paras.status
-- Valid states: draft, issued, replied, settled, pending_recovery, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE para.audit_paras
    ADD CONSTRAINT audit_paras_status_check
    CHECK (status IN ('draft', 'issued', 'replied', 'settled', 'pending_recovery', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- compliance.audit_compliance_reports.status
-- Valid states: draft, submitted, reviewed, approved
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE compliance.audit_compliance_reports
    ADD CONSTRAINT audit_compliance_reports_status_check
    CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- compliance.audit_pending_register.status
-- Valid states: pending, complied, overdue, na
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE compliance.audit_pending_register
    ADD CONSTRAINT audit_pending_register_status_check
    CHECK (status IN ('pending', 'complied', 'overdue', 'na'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- risk.audit_risks.status
-- Valid states: open, mitigating, closed, accepted
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE risk.audit_risks
    ADD CONSTRAINT audit_risks_status_check
    CHECK (status IN ('open', 'mitigating', 'closed', 'accepted'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- risk.audit_risks.mitigation_status
-- Valid states: not_started, in_progress, completed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE risk.audit_risks
    ADD CONSTRAINT audit_risks_mitigation_status_check
    CHECK (mitigation_status IN ('not_started', 'in_progress', 'completed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE exports.exports VALIDATE CONSTRAINT exports_status_check;
ALTER TABLE plan.audit_plans VALIDATE CONSTRAINT audit_plans_status_check;
ALTER TABLE plan.audit_plan_items VALIDATE CONSTRAINT audit_plan_items_status_check;
ALTER TABLE observation.audit_observations VALIDATE CONSTRAINT audit_observations_status_check;
ALTER TABLE para.audit_paras VALIDATE CONSTRAINT audit_paras_status_check;
ALTER TABLE compliance.audit_compliance_reports VALIDATE CONSTRAINT audit_compliance_reports_status_check;
ALTER TABLE compliance.audit_pending_register VALIDATE CONSTRAINT audit_pending_register_status_check;
ALTER TABLE risk.audit_risks VALIDATE CONSTRAINT audit_risks_status_check;
ALTER TABLE risk.audit_risks VALIDATE CONSTRAINT audit_risks_mitigation_status_check;
