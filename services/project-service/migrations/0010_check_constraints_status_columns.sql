-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: project-service
-- Note: Many tables already have inline CHECK constraints from 0001_init.sql and 0005_world_class.sql.
--       This migration ensures coverage for any tables that may lack them and uses NOT VALID + VALIDATE pattern.

SET lock_timeout = '5s';

-- ============================================================================
-- project.project_projects.status
-- Valid states: planned, active, on_hold, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE project.project_projects
    ADD CONSTRAINT project_projects_status_check
    CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- project.project_tasks.status
-- Valid states: pending, in_progress, completed, blocked, cancelled
-- 0001_init.sql's unnamed inline CHECK auto-named itself
-- "project_tasks_status_check" (Postgres default for unnamed column CHECKs),
-- which is the SAME name this migration originally tried to (re-)add with a
-- narrower/different list — so it silently no-op'd via duplicate_object and
-- "cancelled" was never actually permitted. Drop + recreate with the full set.
-- ============================================================================
ALTER TABLE project.project_tasks
  DROP CONSTRAINT IF EXISTS project_tasks_status_check;
ALTER TABLE project.project_tasks
  ADD CONSTRAINT project_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'cancelled'));

-- ============================================================================
-- project.project_milestones.status
-- Valid states: pending, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE project.project_milestones
    ADD CONSTRAINT project_milestones_status_check
    CHECK (status IN ('pending', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- scheme.project_schemes.status
-- Valid states: active, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE scheme.project_schemes
    ADD CONSTRAINT project_schemes_status_check
    CHECK (status IN ('active', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- scheme.project_fund_releases.status
-- Valid states: pending, approved, disbursed, returned
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE scheme.project_fund_releases
    ADD CONSTRAINT project_fund_releases_status_check
    CHECK (status IN ('pending', 'approved', 'disbursed', 'returned'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- utilisation.project_uc_statements.status
-- Valid states: submitted, under_review, approved, revision
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.project_uc_statements
    ADD CONSTRAINT project_uc_statements_status_check
    CHECK (status IN ('submitted', 'under_review', 'approved', 'revision'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- progress.project_dprs.status
-- Valid states: submitted, verified, certified
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE progress.project_dprs
    ADD CONSTRAINT project_dprs_status_check
    CHECK (status IN ('submitted', 'verified', 'certified'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- project.project_risks.status (from 0005_world_class.sql)
-- Valid states: open, mitigated, occurred, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE project.project_risks
    ADD CONSTRAINT project_risks_status_check
    CHECK (status IN ('open', 'mitigated', 'occurred', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- project.project_ra_bills.status (from 0005_world_class.sql)
-- Valid states: submitted, verified, approved, paid, disputed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE project.project_ra_bills
    ADD CONSTRAINT project_ra_bills_status_check
    CHECK (status IN ('submitted', 'verified', 'approved', 'paid', 'disputed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- project.project_time_extensions.status (from 0005_world_class.sql)
-- Valid states: requested, approved, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE project.project_time_extensions
    ADD CONSTRAINT project_time_extensions_status_check
    CHECK (status IN ('requested', 'approved', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- project.project_resources.status (from 0005_world_class.sql)
-- Valid states: allocated, active, released
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE project.project_resources
    ADD CONSTRAINT project_resources_status_check
    CHECK (status IN ('allocated', 'active', 'released'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE project.project_projects VALIDATE CONSTRAINT project_projects_status_check;
-- project_tasks_status_check recreated (not NOT VALID) above — already validated.
ALTER TABLE project.project_milestones VALIDATE CONSTRAINT project_milestones_status_check;
ALTER TABLE scheme.project_schemes VALIDATE CONSTRAINT project_schemes_status_check;
ALTER TABLE scheme.project_fund_releases VALIDATE CONSTRAINT project_fund_releases_status_check;
ALTER TABLE utilisation.project_uc_statements VALIDATE CONSTRAINT project_uc_statements_status_check;
ALTER TABLE progress.project_dprs VALIDATE CONSTRAINT project_dprs_status_check;
ALTER TABLE project.project_risks VALIDATE CONSTRAINT project_risks_status_check;
ALTER TABLE project.project_ra_bills VALIDATE CONSTRAINT project_ra_bills_status_check;
ALTER TABLE project.project_time_extensions VALIDATE CONSTRAINT project_time_extensions_status_check;
ALTER TABLE project.project_resources VALIDATE CONSTRAINT project_resources_status_check;
