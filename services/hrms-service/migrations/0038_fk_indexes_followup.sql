-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: hrms-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- FIXED 2026-08-27: the hrms_apar_scores / hrms_apar_stage_history indexes
-- below were wrongly schema-qualified as "public." — both tables are created
-- by 0017_apar_workflow.sql under the appraisal schema. Corrected.

SET lock_timeout = '5s';

-- employee.hrms_fraud_alerts.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_fraud_alerts_employee_id
  ON employee.hrms_fraud_alerts (employee_id);

-- employee.hrms_employee_risk_scores.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employee_risk_scores_employee_id
  ON employee.hrms_employee_risk_scores (employee_id);

-- employee.hrms_recommendations.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_recommendations_employee_id
  ON employee.hrms_recommendations (employee_id);

-- appraisal.hrms_apar_scores.appraisal_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_apar_scores_appraisal_id
  ON appraisal.hrms_apar_scores (appraisal_id);

-- appraisal.hrms_apar_stage_history.appraisal_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_apar_stage_history_appraisal_id
  ON appraisal.hrms_apar_stage_history (appraisal_id);

-- appraisal.hrms_apar_stage_history.actor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_apar_stage_history_actor_id
  ON appraisal.hrms_apar_stage_history (actor_id);

-- appraisal.hrms_appraisals.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_appraisals_employee_id
  ON appraisal.hrms_appraisals (employee_id);

-- appraisal.hrms_appraisals.reviewer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_appraisals_reviewer_id
  ON appraisal.hrms_appraisals (reviewer_id);

-- appraisal.hrms_appraisals.reporting_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_appraisals_reporting_officer_id
  ON appraisal.hrms_appraisals (reporting_officer_id);

-- appraisal.hrms_appraisals.reviewing_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_appraisals_reviewing_officer_id
  ON appraisal.hrms_appraisals (reviewing_officer_id);

-- appraisal.hrms_appraisals.accepting_authority_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_appraisals_accepting_authority_id
  ON appraisal.hrms_appraisals (accepting_authority_id);

-- attendance.hrms_attendance.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_attendance_employee_id
  ON attendance.hrms_attendance (employee_id);

-- attendance.hrms_attendance_regularisations.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_attendance_regularisations_employee_id
  ON attendance.hrms_attendance_regularisations (employee_id);

-- claims.hrms_ltc_claims.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_ltc_claims_employee_id
  ON claims.hrms_ltc_claims (employee_id);

-- claims.hrms_cea_claims.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_cea_claims_employee_id
  ON claims.hrms_cea_claims (employee_id);

-- lifecycle.hrms_deputations.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_deputations_employee_id
  ON lifecycle.hrms_deputations (employee_id);

-- lifecycle.hrms_deputations.parent_department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_deputations_parent_department_id
  ON lifecycle.hrms_deputations (parent_department_id);

-- lifecycle.hrms_deputations.parent_manager_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_deputations_parent_manager_id
  ON lifecycle.hrms_deputations (parent_manager_id);

-- lifecycle.hrms_deputations.borrowing_department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_deputations_borrowing_department_id
  ON lifecycle.hrms_deputations (borrowing_department_id);

-- lifecycle.hrms_deputations.borrowing_manager_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_deputations_borrowing_manager_id
  ON lifecycle.hrms_deputations (borrowing_manager_id);

-- disciplinary.hrms_disciplinary_cases.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_disciplinary_cases_employee_id
  ON disciplinary.hrms_disciplinary_cases (employee_id);

-- disciplinary.hrms_disciplinary_cases.inquiry_officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_disciplinary_cases_inquiry_officer_id
  ON disciplinary.hrms_disciplinary_cases (inquiry_officer_id);

-- disciplinary.hrms_disciplinary_events.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_disciplinary_events_case_id
  ON disciplinary.hrms_disciplinary_events (case_id);

-- disciplinary.hrms_disciplinary_events.actor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_disciplinary_events_actor_id
  ON disciplinary.hrms_disciplinary_events (actor_id);

-- disciplinary.hrms_suspensions.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_suspensions_employee_id
  ON disciplinary.hrms_suspensions (employee_id);

-- disciplinary.hrms_suspensions.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_suspensions_case_id
  ON disciplinary.hrms_suspensions (case_id);

-- employee.hrms_departments.location_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_departments_location_id
  ON employee.hrms_departments (location_id);

-- employee.hrms_departments.head_employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_departments_head_employee_id
  ON employee.hrms_departments (head_employee_id);

-- employee.hrms_employees.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_department_id
  ON employee.hrms_employees (department_id);

-- employee.hrms_employees.manager_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_manager_id
  ON employee.hrms_employees (manager_id);

-- employee.hrms_employees.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_legal_entity_id
  ON employee.hrms_employees (legal_entity_id);

-- employee.hrms_employees.cost_center_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_cost_center_id
  ON employee.hrms_employees (cost_center_id);

-- employee.hrms_employees.location_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_location_id
  ON employee.hrms_employees (location_id);

-- employee.hrms_profile_photos.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_profile_photos_employee_id
  ON employee.hrms_profile_photos (employee_id);

-- attendance.hrms_face_verification_log.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_face_verification_log_employee_id
  ON attendance.hrms_face_verification_log (employee_id);

-- attendance.hrms_face_verification_log.geo_attendance_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_face_verification_log_geo_attendance_id
  ON attendance.hrms_face_verification_log (geo_attendance_id);

-- attendance.hrms_geo_attendance.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_geo_attendance_employee_id
  ON attendance.hrms_geo_attendance (employee_id);

-- attendance.hrms_geo_attendance.office_location_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_geo_attendance_office_location_id
  ON attendance.hrms_geo_attendance (office_location_id);

-- gpf.hrms_gpf_accounts.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_gpf_accounts_employee_id
  ON gpf.hrms_gpf_accounts (employee_id);

-- gpf.hrms_gpf_ledger.account_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_gpf_ledger_account_id
  ON gpf.hrms_gpf_ledger (account_id);

-- gpf.hrms_gpf_ledger.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_gpf_ledger_employee_id
  ON gpf.hrms_gpf_ledger (employee_id);

-- leave.hrms_leave_allocs.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_allocs_employee_id
  ON leave.hrms_leave_allocs (employee_id);

-- leave.hrms_leave_allocs.leave_type_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_allocs_leave_type_id
  ON leave.hrms_leave_allocs (leave_type_id);

-- leave.hrms_leave_apps.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_apps_employee_id
  ON leave.hrms_leave_apps (employee_id);

-- lifecycle.hrms_transfers.from_desig_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_transfers_from_desig_id
  ON lifecycle.hrms_transfers (from_desig_id);

-- lifecycle.hrms_transfers.to_desig_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_transfers_to_desig_id
  ON lifecycle.hrms_transfers (to_desig_id);

-- lifecycle.hrms_separations.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_separations_employee_id
  ON lifecycle.hrms_separations (employee_id);

-- pension.hrms_pension_records.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_pension_records_employee_id
  ON pension.hrms_pension_records (employee_id);

-- recruitment.hrms_applications.job_opening_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_applications_job_opening_id
  ON recruitment.hrms_applications (job_opening_id);

-- recruitment.hrms_interviews.application_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_interviews_application_id
  ON recruitment.hrms_interviews (application_id);

-- recruitment.hrms_interviews.job_opening_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_interviews_job_opening_id
  ON recruitment.hrms_interviews (job_opening_id);

-- reservation.hrms_roster_points.roster_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_roster_points_roster_id
  ON reservation.hrms_roster_points (roster_id);

-- reservation.hrms_roster_points.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_roster_points_employee_id
  ON reservation.hrms_roster_points (employee_id);

-- reservation.hrms_sanctioned_posts.designation_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_sanctioned_posts_designation_id
  ON reservation.hrms_sanctioned_posts (designation_id);

-- lifecycle.hrms_rti_requests.pio_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_rti_requests_pio_id
  ON lifecycle.hrms_rti_requests (pio_id);

-- scheduler.hrms_due_list.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_due_list_employee_id
  ON scheduler.hrms_due_list (employee_id);

-- training.hrms_nominations.training_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_nominations_training_id
  ON training.hrms_nominations (training_id);
