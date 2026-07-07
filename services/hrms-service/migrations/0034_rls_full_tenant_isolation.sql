-- RLS completion: full tenant isolation (USING + WITH CHECK) for hrms-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION employee.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- appraisal.hrms_appraisals
ALTER TABLE appraisal.hrms_appraisals ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal.hrms_appraisals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON appraisal.hrms_appraisals;
DROP POLICY IF EXISTS tenant_isolation ON appraisal.hrms_appraisals;
CREATE POLICY tenant_isolation_policy ON appraisal.hrms_appraisals
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_attendance
ALTER TABLE attendance.hrms_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_attendance;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_attendance;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_attendance
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_attendance_regularisations
ALTER TABLE attendance.hrms_attendance_regularisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_attendance_regularisations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_attendance_regularisations;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_attendance_regularisations;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_attendance_regularisations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_geo_attendance
ALTER TABLE attendance.hrms_geo_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_geo_attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_geo_attendance;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_geo_attendance;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_geo_attendance
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_office_locations
ALTER TABLE attendance.hrms_office_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_office_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_office_locations;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_office_locations;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_office_locations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_shift_assignments
ALTER TABLE attendance.hrms_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_shift_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_shift_assignments;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_shift_assignments;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_shift_assignments
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_shifts
ALTER TABLE attendance.hrms_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_shifts;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_shifts;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_shifts
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- claims.hrms_cea_claims
ALTER TABLE claims.hrms_cea_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_cea_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON claims.hrms_cea_claims;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_cea_claims;
CREATE POLICY tenant_isolation_policy ON claims.hrms_cea_claims
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- claims.hrms_ltc_claims
ALTER TABLE claims.hrms_ltc_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_ltc_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON claims.hrms_ltc_claims;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_ltc_claims;
CREATE POLICY tenant_isolation_policy ON claims.hrms_ltc_claims
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- disciplinary.hrms_disciplinary_cases
ALTER TABLE disciplinary.hrms_disciplinary_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary.hrms_disciplinary_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON disciplinary.hrms_disciplinary_cases;
DROP POLICY IF EXISTS tenant_isolation ON disciplinary.hrms_disciplinary_cases;
CREATE POLICY tenant_isolation_policy ON disciplinary.hrms_disciplinary_cases
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- disciplinary.hrms_disciplinary_events
ALTER TABLE disciplinary.hrms_disciplinary_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary.hrms_disciplinary_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON disciplinary.hrms_disciplinary_events;
DROP POLICY IF EXISTS tenant_isolation ON disciplinary.hrms_disciplinary_events;
CREATE POLICY tenant_isolation_policy ON disciplinary.hrms_disciplinary_events
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- disciplinary.hrms_suspensions
ALTER TABLE disciplinary.hrms_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary.hrms_suspensions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON disciplinary.hrms_suspensions;
DROP POLICY IF EXISTS tenant_isolation ON disciplinary.hrms_suspensions;
CREATE POLICY tenant_isolation_policy ON disciplinary.hrms_suspensions
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_departments
ALTER TABLE employee.hrms_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_departments;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_departments;
CREATE POLICY tenant_isolation_policy ON employee.hrms_departments
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_designations
ALTER TABLE employee.hrms_designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_designations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_designations;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_designations;
CREATE POLICY tenant_isolation_policy ON employee.hrms_designations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_employee_docs
ALTER TABLE employee.hrms_employee_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_employee_docs;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_employee_docs;
CREATE POLICY tenant_isolation_policy ON employee.hrms_employee_docs
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_employee_risk_scores
ALTER TABLE employee.hrms_employee_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_risk_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_employee_risk_scores;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_employee_risk_scores;
CREATE POLICY tenant_isolation_policy ON employee.hrms_employee_risk_scores
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_employees
ALTER TABLE employee.hrms_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_employees;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_employees;
CREATE POLICY tenant_isolation_policy ON employee.hrms_employees
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_face_config
ALTER TABLE employee.hrms_face_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_face_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_face_config;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_face_config;
CREATE POLICY tenant_isolation_policy ON employee.hrms_face_config
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_face_verification_log
ALTER TABLE employee.hrms_face_verification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_face_verification_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_face_verification_log;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_face_verification_log;
CREATE POLICY tenant_isolation_policy ON employee.hrms_face_verification_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_fraud_alerts
ALTER TABLE employee.hrms_fraud_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_fraud_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_fraud_alerts;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_fraud_alerts;
CREATE POLICY tenant_isolation_policy ON employee.hrms_fraud_alerts
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_profile_photos
ALTER TABLE employee.hrms_profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_profile_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_profile_photos;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_profile_photos;
CREATE POLICY tenant_isolation_policy ON employee.hrms_profile_photos
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_recommendations
ALTER TABLE employee.hrms_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_recommendations;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_recommendations;
CREATE POLICY tenant_isolation_policy ON employee.hrms_recommendations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- gpf.hrms_gpf_accounts
ALTER TABLE gpf.hrms_gpf_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpf.hrms_gpf_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gpf.hrms_gpf_accounts;
DROP POLICY IF EXISTS tenant_isolation ON gpf.hrms_gpf_accounts;
CREATE POLICY tenant_isolation_policy ON gpf.hrms_gpf_accounts
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- gpf.hrms_gpf_ledger
ALTER TABLE gpf.hrms_gpf_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpf.hrms_gpf_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gpf.hrms_gpf_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gpf.hrms_gpf_ledger;
CREATE POLICY tenant_isolation_policy ON gpf.hrms_gpf_ledger
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_holidays
ALTER TABLE leave.hrms_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_holidays FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_holidays;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_holidays;
CREATE POLICY tenant_isolation_policy ON leave.hrms_holidays
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_allocs
ALTER TABLE leave.hrms_leave_allocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_allocs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_allocs;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_allocs;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_allocs
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_apps
ALTER TABLE leave.hrms_leave_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_apps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_apps;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_apps;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_apps
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_types
ALTER TABLE leave.hrms_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_types;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_types;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_types
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- lifecycle.hrms_deputations
ALTER TABLE lifecycle.hrms_deputations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_deputations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_deputations;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_deputations;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_deputations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- lifecycle.hrms_promotions
ALTER TABLE lifecycle.hrms_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_promotions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_promotions;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_promotions;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_promotions
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- lifecycle.hrms_rti_requests
ALTER TABLE lifecycle.hrms_rti_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_rti_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_rti_requests;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_rti_requests;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_rti_requests
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- lifecycle.hrms_separations
ALTER TABLE lifecycle.hrms_separations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_separations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_separations;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_separations;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_separations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- lifecycle.hrms_service_book_entries
ALTER TABLE lifecycle.hrms_service_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_service_book_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_service_book_entries;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_service_book_entries;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_service_book_entries
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- lifecycle.hrms_transfers
ALTER TABLE lifecycle.hrms_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_transfers;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_transfers;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_transfers
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- pension.hrms_pension_records
ALTER TABLE pension.hrms_pension_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pension.hrms_pension_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON pension.hrms_pension_records;
DROP POLICY IF EXISTS tenant_isolation ON pension.hrms_pension_records;
CREATE POLICY tenant_isolation_policy ON pension.hrms_pension_records
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- public.hrms_apar_scores
ALTER TABLE public.hrms_apar_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hrms_apar_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON public.hrms_apar_scores;
DROP POLICY IF EXISTS tenant_isolation ON public.hrms_apar_scores;
CREATE POLICY tenant_isolation_policy ON public.hrms_apar_scores
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- public.hrms_apar_stage_history
ALTER TABLE public.hrms_apar_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hrms_apar_stage_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON public.hrms_apar_stage_history;
DROP POLICY IF EXISTS tenant_isolation ON public.hrms_apar_stage_history;
CREATE POLICY tenant_isolation_policy ON public.hrms_apar_stage_history
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- recruitment.hrms_applications
ALTER TABLE recruitment.hrms_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recruitment.hrms_applications;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_applications;
CREATE POLICY tenant_isolation_policy ON recruitment.hrms_applications
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- recruitment.hrms_interviews
ALTER TABLE recruitment.hrms_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recruitment.hrms_interviews;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_interviews;
CREATE POLICY tenant_isolation_policy ON recruitment.hrms_interviews
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- recruitment.hrms_job_openings
ALTER TABLE recruitment.hrms_job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_job_openings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recruitment.hrms_job_openings;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_job_openings;
CREATE POLICY tenant_isolation_policy ON recruitment.hrms_job_openings
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- recruitment.hrms_offers
ALTER TABLE recruitment.hrms_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_offers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recruitment.hrms_offers;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_offers;
CREATE POLICY tenant_isolation_policy ON recruitment.hrms_offers
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- reservation.hrms_roster_points
ALTER TABLE reservation.hrms_roster_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation.hrms_roster_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON reservation.hrms_roster_points;
DROP POLICY IF EXISTS tenant_isolation ON reservation.hrms_roster_points;
CREATE POLICY tenant_isolation_policy ON reservation.hrms_roster_points
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- reservation.hrms_rosters
ALTER TABLE reservation.hrms_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation.hrms_rosters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON reservation.hrms_rosters;
DROP POLICY IF EXISTS tenant_isolation ON reservation.hrms_rosters;
CREATE POLICY tenant_isolation_policy ON reservation.hrms_rosters
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- reservation.hrms_sanctioned_posts
ALTER TABLE reservation.hrms_sanctioned_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation.hrms_sanctioned_posts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON reservation.hrms_sanctioned_posts;
DROP POLICY IF EXISTS tenant_isolation ON reservation.hrms_sanctioned_posts;
CREATE POLICY tenant_isolation_policy ON reservation.hrms_sanctioned_posts
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- scheduler.hrms_due_list
ALTER TABLE scheduler.hrms_due_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler.hrms_due_list FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheduler.hrms_due_list;
DROP POLICY IF EXISTS tenant_isolation ON scheduler.hrms_due_list;
CREATE POLICY tenant_isolation_policy ON scheduler.hrms_due_list
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- training.hrms_nominations
ALTER TABLE training.hrms_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_nominations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON training.hrms_nominations;
DROP POLICY IF EXISTS tenant_isolation ON training.hrms_nominations;
CREATE POLICY tenant_isolation_policy ON training.hrms_nominations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- training.hrms_trainings
ALTER TABLE training.hrms_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_trainings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON training.hrms_trainings;
DROP POLICY IF EXISTS tenant_isolation ON training.hrms_trainings;
CREATE POLICY tenant_isolation_policy ON training.hrms_trainings
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = employee.current_tenant_id())
      WITH CHECK (tenant_id = employee.current_tenant_id())';
  END IF;
END $$;
