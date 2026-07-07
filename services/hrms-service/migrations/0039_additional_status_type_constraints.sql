-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: hrms-service

SET lock_timeout = '5s';

-- ============================================================================
-- employee.hrms_departments.type
-- Valid states: ministry, department, attached_office, subordinate_office, wing,
-- division, branch, section, desk, directorate, regional_office, district_office,
-- corporation, council, panchayat, zone, ward_office, board, commission,
-- authority, university, institute, company, corporate, region, plant, depot,
-- unit, business_unit, vertical, function, practice, delivery_center, team,
-- organisation, program, state_unit, district_unit, federation, district_union,
-- society, firm, office (source: modules/employee/dept-domain.ts — the union of
-- CENTRAL_GOVT_TYPES/STATE_GOVT_TYPES/LOCAL_BODY_TYPES/STATUTORY_TYPES/
-- PSU_TYPES/PRIVATE_TYPES/NGO_TYPES/COOPERATIVE_TYPES/SMALL_OFFICE_TYPES
-- enforced app-side by isValidDeptType()). Column is nullable — small offices
-- leave it unset (freeform), per isValidDeptType()'s null passthrough.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE employee.hrms_departments
    ADD CONSTRAINT hrms_departments_type_check
    CHECK (type IS NULL OR type IN (
      'ministry', 'department', 'attached_office', 'subordinate_office', 'wing',
      'division', 'branch', 'section', 'desk', 'directorate', 'regional_office',
      'district_office', 'corporation', 'council', 'panchayat', 'zone',
      'ward_office', 'board', 'commission', 'authority', 'university',
      'institute', 'company', 'corporate', 'region', 'plant', 'depot', 'unit',
      'business_unit', 'vertical', 'function', 'practice', 'delivery_center',
      'team', 'organisation', 'program', 'state_unit', 'district_unit',
      'federation', 'district_union', 'society', 'firm', 'office'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- recruitment.hrms_job_openings.vacancy_type
-- Valid values: regular, internship, apprenticeship, contractual, deputation
-- (source: modules/recruitment/validators.ts VACANCY_TYPES)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE recruitment.hrms_job_openings
    ADD CONSTRAINT hrms_job_openings_vacancy_type_check
    CHECK (vacancy_type IN ('regular', 'internship', 'apprenticeship', 'contractual', 'deputation'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- attendance.hrms_attendance_regularisations.requested_status
-- Valid values: present, absent, half_day
-- (source: modules/attendance/validators.ts requestedStatus enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE attendance.hrms_attendance_regularisations
    ADD CONSTRAINT hrms_attendance_regularisations_requested_status_check
    CHECK (requested_status IN ('present', 'absent', 'half_day'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- lifecycle.hrms_separations.separation_type
-- Valid values: resignation, retirement, termination, vrs, death
-- (source: modules/lifecycle/validators.ts separateBody — the only validator
-- gating writes into this table via employee/routes.ts -> commands.separateEmployee
-- -> COMMANDS.employeeSeparate -> lifecycle/consumer.ts insertSeparation)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE lifecycle.hrms_separations
    ADD CONSTRAINT hrms_separations_separation_type_check
    CHECK (separation_type IN ('resignation', 'retirement', 'termination', 'vrs', 'death'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- disciplinary.hrms_disciplinary_cases.penalty_type
-- Valid values: censure, withholding_promotion, recovery_from_pay,
-- withholding_increment, reduction_to_lower_stage_minor (MINOR_PENALTIES),
-- reduction_to_lower_stage, reduction_to_lower_rank, compulsory_retirement,
-- removal_from_service, dismissal (MAJOR_PENALTIES)
-- (source: modules/disciplinary/state-machine.ts — routes.ts rejects any
-- penaltyType not in this union with 400 UNKNOWN_PENALTY). Column is nullable
-- until a penalty is imposed.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE disciplinary.hrms_disciplinary_cases
    ADD CONSTRAINT hrms_disciplinary_cases_penalty_type_check
    CHECK (penalty_type IS NULL OR penalty_type IN (
      'censure', 'withholding_promotion', 'recovery_from_pay',
      'withholding_increment', 'reduction_to_lower_stage_minor',
      'reduction_to_lower_stage', 'reduction_to_lower_rank',
      'compulsory_retirement', 'removal_from_service', 'dismissal'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- disciplinary.hrms_disciplinary_events.to_status
-- Valid states: opened, charge_memo_issued, inquiry_appointed, finding_recorded,
-- pending_approval, penalty_imposed, appeal_filed, appeal_decided, closed,
-- dropped (reuses the hrms_disciplinary_cases.status state machine — see
-- migration 0029_disciplinary_pending_approval_status.sql for the full list;
-- modules/disciplinary/routes.ts + eoffice-consumer.ts write case.status values
-- into to_status on every transition). Column is NOT NULL.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE disciplinary.hrms_disciplinary_events
    ADD CONSTRAINT hrms_disciplinary_events_to_status_check
    CHECK (to_status IN (
      'opened', 'charge_memo_issued', 'inquiry_appointed', 'finding_recorded',
      'pending_approval', 'penalty_imposed', 'appeal_filed', 'appeal_decided',
      'closed', 'dropped'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- disciplinary.hrms_disciplinary_events.from_status
-- Same state list as to_status above. Column is nullable — routes.ts records
-- fromStatus: null for the initial "open" event (case has no prior status).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE disciplinary.hrms_disciplinary_events
    ADD CONSTRAINT hrms_disciplinary_events_from_status_check
    CHECK (from_status IS NULL OR from_status IN (
      'opened', 'charge_memo_issued', 'inquiry_appointed', 'finding_recorded',
      'pending_approval', 'penalty_imposed', 'appeal_filed', 'appeal_decided',
      'closed', 'dropped'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- employee.hrms_employee_docs.doc_type — SKIPPED.
-- No route, consumer, or command in modules/employee/** currently writes to
-- this table (hrmsEmployeeDocs is exported from schema.ts but has zero call
-- sites elsewhere in src/). Without a live writer there is no discoverable
-- finite value set to enforce, and guessing one (e.g. copying the unrelated
-- legacy employee.hrms_documents vocabulary from migration 0004) risks
-- rejecting whatever values a future feature actually needs. Left unconstrained.
-- ============================================================================

-- ============================================================================
-- employee.hrms_fraud_alerts.alert_type — SKIPPED, already covered.
-- migration 0011_ai_fraud_detection.sql already added an inline CHECK
-- (alert_type IN ('gps_spoofing','buddy_punch','impossible_time',
-- 'device_anomaly','ghost_employee','duplicate_bank','salary_anomaly',
-- 'unpaid_attendance','leave_pattern_abuse','monday_friday_pattern',
-- 'sandwich_avoidance','approver_collusion','attrition_risk','overtime_abuse',
-- 'proxy_attendance','inactive_on_payroll')) on table creation, which Postgres
-- auto-named hrms_fraud_alerts_alert_type_check — the exact name this
-- migration would use. That set already covers every literal alertType
-- written by ai-fraud/routes.ts and detection-engine.ts. Nothing to add.
-- ============================================================================

-- ============================================================================
-- employee.hrms_fraud_alerts.status — SKIPPED, already covered.
-- migration 0011_ai_fraud_detection.sql already added an inline CHECK
-- (status IN ('open','investigating','confirmed','dismissed','resolved')) on
-- table creation, auto-named hrms_fraud_alerts_status_check. This is the
-- active constraint in production: a later migration (0035) attempted to add
-- a same-named but narrower list (missing 'confirmed') which would have been
-- rejected as duplicate_object and silently no-opped, leaving the original
-- 0011 constraint — which correctly includes 'confirmed' as written by
-- PATCH /v1/hrms/ai/alerts/:id — in force. Nothing to add here.
-- ============================================================================

-- ============================================================================
-- attendance.hrms_geo_attendance.check_type — SKIPPED, already covered.
-- migration 0007_geo_attendance_ro.sql already added an inline CHECK
-- (check_type IN ('check_in', 'check_out')) on table creation, auto-named
-- hrms_geo_attendance_check_type_check, matching the only two literal values
-- written by modules/geo-attendance/routes.ts. Nothing to add.
-- ============================================================================

-- ============================================================================
-- leave.hrms_holidays.type — SKIPPED, already covered.
-- migration 0004_production_ready.sql already added an inline CHECK
-- (type IN ('gazetted','restricted','optional','weekly_off')) on table
-- creation, and migration 0035_check_constraints_status_columns.sql
-- idempotently re-asserted the identical constraint under the same
-- auto-generated name (hrms_holidays_type_check). Nothing to add.
-- ============================================================================

-- ============================================================================
-- lifecycle.hrms_service_book_entries.entry_type — SKIPPED, genuinely open-ended.
-- POST /v1/hrms/employees/:id/service-book validates entryType only as
-- z.string().min(1) (modules/service-book/routes.ts) — no zod enum. At least
-- six independent modules write their own entry_type literals into this table
-- (service-book direct API, lifecycle promotions/transfers, deputation
-- in/out/cancel, pay-matrix increments, training completions), plus a
-- separate open-ended NON_QUALIFYING_ENTRY_TYPES vocabulary consumed by the
-- pension engine (modules/pension/engine.ts: dies_non, eol_without_qs,
-- suspension_non_duty, boy_service, temporary_service). The service book is
-- an extensible career-history journal by design; no fixed enumeration is
-- enforced or discoverable. Forcing a CHECK here would break future entry
-- categories recorded through the open API. Left unconstrained.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE employee.hrms_departments VALIDATE CONSTRAINT hrms_departments_type_check;
ALTER TABLE recruitment.hrms_job_openings VALIDATE CONSTRAINT hrms_job_openings_vacancy_type_check;
ALTER TABLE attendance.hrms_attendance_regularisations VALIDATE CONSTRAINT hrms_attendance_regularisations_requested_status_check;
ALTER TABLE lifecycle.hrms_separations VALIDATE CONSTRAINT hrms_separations_separation_type_check;
ALTER TABLE disciplinary.hrms_disciplinary_cases VALIDATE CONSTRAINT hrms_disciplinary_cases_penalty_type_check;
ALTER TABLE disciplinary.hrms_disciplinary_events VALIDATE CONSTRAINT hrms_disciplinary_events_to_status_check;
ALTER TABLE disciplinary.hrms_disciplinary_events VALIDATE CONSTRAINT hrms_disciplinary_events_from_status_check;
