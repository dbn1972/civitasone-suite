-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: hrms-service

SET lock_timeout = '5s';

-- ============================================================================
-- leave.hrms_leave_apps.status
-- Valid states: draft, pending, approved, rejected, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE leave.hrms_leave_apps
    ADD CONSTRAINT hrms_leave_apps_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- attendance.hrms_attendance.status
-- Valid states: present, absent, half_day, on_leave, holiday, weekly_off, work_from_home
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE attendance.hrms_attendance
    ADD CONSTRAINT hrms_attendance_status_check
    CHECK (status IN ('present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'work_from_home'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- attendance.hrms_attendance_regularisations.status
-- Valid states: pending, approved, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE attendance.hrms_attendance_regularisations
    ADD CONSTRAINT hrms_attendance_regularisations_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- employee.hrms_employees.status
-- Valid states: probation, confirmed, suspended, resigned, retired, terminated, deceased
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE employee.hrms_employees
    ADD CONSTRAINT hrms_employees_status_check
    CHECK (status IN ('probation', 'confirmed', 'suspended', 'resigned', 'retired', 'terminated', 'deceased'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- NOTE (investigated post-hoc, see fix/hrms-employee-status-drift PR): the block
-- above never took effect. Migration 0025 already created a constraint named
-- hrms_employees_status_check with a DIFFERENT 8-value list (probation,
-- confirmed, on_leave, suspended, deputation, retired, separated, terminated),
-- so this ADD CONSTRAINT hit the EXCEPTION WHEN duplicate_object handler above
-- and silently no-op'd -- 'resigned'/'deceased' were never enforced or usable.
-- Investigation found zero references to employee status 'resigned' or
-- 'deceased' anywhere in the app (routes, validators, apps/web, BRD/docs); the
-- only string hits elsewhere are unrelated domains (meeting-service committee
-- membership, animal-service registration, court-service case parties).
-- Conversely, on_leave/deputation/separated (this block's omissions) are load-
-- bearing: employee/status.ts's canonical EMPLOYEE_STATUSES + SERVING_STATUSES,
-- dashboard/queries.ts, ai-predictions/routes.ts, workforce-planning/routes.ts,
-- seniority/routes.ts, orgchart/queries.ts, reservation/routes.ts,
-- scheduler/tick.ts, and employee/consumer.ts + lifecycle/consumer.ts (which
-- WRITE status='separated') all depend on them, with dedicated contract tests
-- (status.test.ts, employee-status-contract.test.ts, employee-validators.test.ts,
-- status-contract.test.ts) asserting they are valid. Migration 0025's list --
-- now with 'no_show' added by migration 0130 (PR #898/#902) -- is the
-- authoritative, actually-enforced contract. Do not attempt to re-apply this
-- block's list; it was superseded before it ever ran.
-- ============================================================================

-- ============================================================================
-- employee.hrms_employees.employee_type
-- Valid values: permanent, contractual, deputation, ad_hoc, temporary, consultant
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE employee.hrms_employees
    ADD CONSTRAINT hrms_employees_employee_type_check
    CHECK (employee_type IN ('permanent', 'contractual', 'deputation', 'ad_hoc', 'temporary', 'consultant'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- appraisal.hrms_appraisals.status
-- Valid states: pending, self_assessed, reviewed, accepted, moderated, finalised
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE appraisal.hrms_appraisals
    ADD CONSTRAINT hrms_appraisals_status_check
    CHECK (status IN ('pending', 'self_assessed', 'reviewed', 'accepted', 'moderated', 'finalised'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- recruitment.hrms_job_openings.status
-- Valid states: open, closed, cancelled, filled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE recruitment.hrms_job_openings
    ADD CONSTRAINT hrms_job_openings_status_check
    CHECK (status IN ('open', 'closed', 'cancelled', 'filled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- recruitment.hrms_applications.status
-- Valid states: active, shortlisted, rejected, offered, joined, withdrawn
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE recruitment.hrms_applications
    ADD CONSTRAINT hrms_applications_status_check
    CHECK (status IN ('active', 'shortlisted', 'rejected', 'offered', 'joined', 'withdrawn'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- recruitment.hrms_offers.status
-- Valid states: draft (schema default), sent (consumer.ts on offer.send)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE recruitment.hrms_offers
    ADD CONSTRAINT hrms_offers_status_check
    CHECK (status IN ('draft', 'sent'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- leave.hrms_holidays.type
-- Valid values: gazetted, restricted, optional, weekly_off (routes.ts zod enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE leave.hrms_holidays
    ADD CONSTRAINT hrms_holidays_type_check
    CHECK (type IN ('gazetted', 'restricted', 'optional', 'weekly_off'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- training.hrms_trainings.status
-- Valid states: planned, in_progress, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE training.hrms_trainings
    ADD CONSTRAINT hrms_trainings_status_check
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- training.hrms_nominations.status
-- Valid states: nominated, approved, attended, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE training.hrms_nominations
    ADD CONSTRAINT hrms_nominations_status_check
    CHECK (status IN ('nominated', 'approved', 'attended', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- disciplinary.hrms_disciplinary_cases.status
-- A correctly-named, correctly-valued CHECK constraint
-- (hrms_disc_cases_status_check) already exists on this column from migration
-- 0029, covering the real state machine: opened, charge_memo_issued,
-- inquiry_appointed, finding_recorded, pending_approval, penalty_imposed,
-- appeal_filed, appeal_decided, closed, dropped.
-- Do NOT add a second CHECK with a different name/vocabulary here — Postgres
-- ANDs multiple CHECK constraints on the same column, and this file's original
-- narrower/mismatched list ('charge_sheet_issued', 'enquiry' — which don't
-- exist in the real state machine) would reject valid transitions and break
-- the disciplinary + eOffice approval workflow. Nothing to add.
-- ============================================================================

-- ============================================================================
-- disciplinary.hrms_suspensions.status
-- Valid states: active, revoked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE disciplinary.hrms_suspensions
    ADD CONSTRAINT hrms_suspensions_status_check
    CHECK (status IN ('active', 'revoked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.hrms_deputations.status
-- Valid states: active, repatriated, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_deputations
    ADD CONSTRAINT hrms_deputations_status_check
    CHECK (status IN ('active', 'repatriated', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- claims.hrms_ltc_claims.status
-- Valid states: submitted, approved, rejected, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE claims.hrms_ltc_claims
    ADD CONSTRAINT hrms_ltc_claims_status_check
    CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- claims.hrms_cea_claims.status
-- Valid states: submitted, approved, rejected, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE claims.hrms_cea_claims
    ADD CONSTRAINT hrms_cea_claims_status_check
    CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.hrms_transfers.status
-- Valid states: pending, approved, rejected, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_transfers
    ADD CONSTRAINT hrms_transfers_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.hrms_promotions.status
-- Valid states: pending, approved, rejected, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_promotions
    ADD CONSTRAINT hrms_promotions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.hrms_separations.status
-- Valid states: initiated, approved, pending, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_separations
    ADD CONSTRAINT hrms_separations_status_check
    CHECK (status IN ('initiated', 'approved', 'pending', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- gpf.hrms_gpf_accounts.status
-- Valid states: active, closed, frozen
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gpf.hrms_gpf_accounts
    ADD CONSTRAINT hrms_gpf_accounts_status_check
    CHECK (status IN ('active', 'closed', 'frozen'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.hrms_rti_requests.status
-- Valid states: filed, acknowledged, responded, appealed, closed, transferred
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_rti_requests
    ADD CONSTRAINT hrms_rti_requests_status_check
    CHECK (status IN ('filed', 'acknowledged', 'responded', 'appealed', 'closed', 'transferred'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- scheduler.hrms_scheduler_runs.status
-- Valid states: running, completed, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE scheduler.hrms_scheduler_runs
    ADD CONSTRAINT hrms_scheduler_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- employee.hrms_fraud_alerts.status
-- Valid states: open, investigating, resolved, dismissed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE employee.hrms_fraud_alerts
    ADD CONSTRAINT hrms_fraud_alerts_status_check
    CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- reservation.hrms_rosters.status
-- Valid states: active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE reservation.hrms_rosters
    ADD CONSTRAINT hrms_rosters_status_check
    CHECK (status IN ('active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- reservation.hrms_sanctioned_posts.status
-- A correctly-named CHECK constraint (hrms_sanc_posts_status_check) already
-- exists on this column from migration 0022, covering ('active', 'frozen') —
-- the only values the schema default/routes.ts write today.
-- Do NOT add a second CHECK with a different vocabulary ('abolished', 'vacant'
-- were never in the original set) — Postgres ANDs multiple CHECK constraints
-- on the same column, and this would make 'frozen' (a real, reachable value)
-- rejected. Nothing to add.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE leave.hrms_leave_apps VALIDATE CONSTRAINT hrms_leave_apps_status_check;
ALTER TABLE attendance.hrms_attendance VALIDATE CONSTRAINT hrms_attendance_status_check;
ALTER TABLE attendance.hrms_attendance_regularisations VALIDATE CONSTRAINT hrms_attendance_regularisations_status_check;
ALTER TABLE employee.hrms_employees VALIDATE CONSTRAINT hrms_employees_status_check;
ALTER TABLE employee.hrms_employees VALIDATE CONSTRAINT hrms_employees_employee_type_check;
ALTER TABLE appraisal.hrms_appraisals VALIDATE CONSTRAINT hrms_appraisals_status_check;
ALTER TABLE recruitment.hrms_job_openings VALIDATE CONSTRAINT hrms_job_openings_status_check;
ALTER TABLE recruitment.hrms_applications VALIDATE CONSTRAINT hrms_applications_status_check;
ALTER TABLE recruitment.hrms_offers VALIDATE CONSTRAINT hrms_offers_status_check;
ALTER TABLE leave.hrms_holidays VALIDATE CONSTRAINT hrms_holidays_type_check;
ALTER TABLE training.hrms_trainings VALIDATE CONSTRAINT hrms_trainings_status_check;
ALTER TABLE training.hrms_nominations VALIDATE CONSTRAINT hrms_nominations_status_check;
ALTER TABLE disciplinary.hrms_suspensions VALIDATE CONSTRAINT hrms_suspensions_status_check;
ALTER TABLE lifecycle.hrms_deputations VALIDATE CONSTRAINT hrms_deputations_status_check;
ALTER TABLE claims.hrms_ltc_claims VALIDATE CONSTRAINT hrms_ltc_claims_status_check;
ALTER TABLE claims.hrms_cea_claims VALIDATE CONSTRAINT hrms_cea_claims_status_check;
ALTER TABLE lifecycle.hrms_transfers VALIDATE CONSTRAINT hrms_transfers_status_check;
ALTER TABLE lifecycle.hrms_promotions VALIDATE CONSTRAINT hrms_promotions_status_check;
ALTER TABLE lifecycle.hrms_separations VALIDATE CONSTRAINT hrms_separations_status_check;
ALTER TABLE gpf.hrms_gpf_accounts VALIDATE CONSTRAINT hrms_gpf_accounts_status_check;
ALTER TABLE lifecycle.hrms_rti_requests VALIDATE CONSTRAINT hrms_rti_requests_status_check;
ALTER TABLE scheduler.hrms_scheduler_runs VALIDATE CONSTRAINT hrms_scheduler_runs_status_check;
ALTER TABLE employee.hrms_fraud_alerts VALIDATE CONSTRAINT hrms_fraud_alerts_status_check;
ALTER TABLE reservation.hrms_rosters VALIDATE CONSTRAINT hrms_rosters_status_check;
