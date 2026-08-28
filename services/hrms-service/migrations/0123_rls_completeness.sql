-- RLS completeness: cover all tenant-scoped tables missing full enforcement
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for 52 tables
--          created in migrations after the 0034 full RLS pass, or missed by it.
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- ── appraisal schema ──────────────────────────────────────────────

-- appraisal.hrms_apar_scores
ALTER TABLE appraisal.hrms_apar_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal.hrms_apar_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON appraisal.hrms_apar_scores;
DROP POLICY IF EXISTS tenant_isolation ON appraisal.hrms_apar_scores;
CREATE POLICY tenant_isolation_policy ON appraisal.hrms_apar_scores
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- appraisal.hrms_apar_stage_history
ALTER TABLE appraisal.hrms_apar_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal.hrms_apar_stage_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON appraisal.hrms_apar_stage_history;
DROP POLICY IF EXISTS tenant_isolation ON appraisal.hrms_apar_stage_history;
CREATE POLICY tenant_isolation_policy ON appraisal.hrms_apar_stage_history
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── attendance schema ─────────────────────────────────────────────

-- attendance.hrms_face_config
ALTER TABLE attendance.hrms_face_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_face_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_face_config;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_face_config;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_face_config
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_face_verification_log
ALTER TABLE attendance.hrms_face_verification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_face_verification_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_face_verification_log;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_face_verification_log;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_face_verification_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_overtime
ALTER TABLE attendance.hrms_overtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_overtime FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_overtime;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_overtime;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_overtime
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- attendance.hrms_shift_roster
ALTER TABLE attendance.hrms_shift_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_shift_roster FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_shift_roster;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_shift_roster;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_shift_roster
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── employee schema ───────────────────────────────────────────────

-- employee.benefit_elections
ALTER TABLE employee.benefit_elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.benefit_elections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.benefit_elections;
DROP POLICY IF EXISTS tenant_isolation ON employee.benefit_elections;
CREATE POLICY tenant_isolation_policy ON employee.benefit_elections
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.benefit_plans
ALTER TABLE employee.benefit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.benefit_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.benefit_plans;
DROP POLICY IF EXISTS tenant_isolation ON employee.benefit_plans;
CREATE POLICY tenant_isolation_policy ON employee.benefit_plans
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.compensation_plans
ALTER TABLE employee.compensation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.compensation_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.compensation_plans;
DROP POLICY IF EXISTS tenant_isolation ON employee.compensation_plans;
CREATE POLICY tenant_isolation_policy ON employee.compensation_plans
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.compensation_recommendations
ALTER TABLE employee.compensation_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.compensation_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.compensation_recommendations;
DROP POLICY IF EXISTS tenant_isolation ON employee.compensation_recommendations;
CREATE POLICY tenant_isolation_policy ON employee.compensation_recommendations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.competencies
ALTER TABLE employee.competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.competencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.competencies;
DROP POLICY IF EXISTS tenant_isolation ON employee.competencies;
CREATE POLICY tenant_isolation_policy ON employee.competencies
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.feedback_cycles
ALTER TABLE employee.feedback_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.feedback_cycles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.feedback_cycles;
DROP POLICY IF EXISTS tenant_isolation ON employee.feedback_cycles;
CREATE POLICY tenant_isolation_policy ON employee.feedback_cycles
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.feedback_nominations
ALTER TABLE employee.feedback_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.feedback_nominations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.feedback_nominations;
DROP POLICY IF EXISTS tenant_isolation ON employee.feedback_nominations;
CREATE POLICY tenant_isolation_policy ON employee.feedback_nominations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.feedback_responses
ALTER TABLE employee.feedback_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.feedback_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.feedback_responses;
DROP POLICY IF EXISTS tenant_isolation ON employee.feedback_responses;
CREATE POLICY tenant_isolation_policy ON employee.feedback_responses
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_documents
ALTER TABLE employee.hrms_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_documents;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_documents;
CREATE POLICY tenant_isolation_policy ON employee.hrms_documents
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_employee_types
ALTER TABLE employee.hrms_employee_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_employee_types;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_employee_types;
CREATE POLICY tenant_isolation_policy ON employee.hrms_employee_types
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_generated_letters
ALTER TABLE employee.hrms_generated_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_generated_letters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_generated_letters;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_generated_letters;
CREATE POLICY tenant_isolation_policy ON employee.hrms_generated_letters
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_import_batches
ALTER TABLE employee.hrms_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_import_batches;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_import_batches;
CREATE POLICY tenant_isolation_policy ON employee.hrms_import_batches
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_letter_templates
ALTER TABLE employee.hrms_letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_letter_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_letter_templates;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_letter_templates;
CREATE POLICY tenant_isolation_policy ON employee.hrms_letter_templates
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_ml_runs
ALTER TABLE employee.hrms_ml_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_ml_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_ml_runs;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_ml_runs;
CREATE POLICY tenant_isolation_policy ON employee.hrms_ml_runs
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_office_locations
ALTER TABLE employee.hrms_office_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_office_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_office_locations;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_office_locations;
CREATE POLICY tenant_isolation_policy ON employee.hrms_office_locations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_service_book
ALTER TABLE employee.hrms_service_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_service_book FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_service_book;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_service_book;
CREATE POLICY tenant_isolation_policy ON employee.hrms_service_book
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.onboarding_instances
ALTER TABLE employee.onboarding_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.onboarding_instances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.onboarding_instances;
DROP POLICY IF EXISTS tenant_isolation ON employee.onboarding_instances;
CREATE POLICY tenant_isolation_policy ON employee.onboarding_instances
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.onboarding_templates
ALTER TABLE employee.onboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.onboarding_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.onboarding_templates;
DROP POLICY IF EXISTS tenant_isolation ON employee.onboarding_templates;
CREATE POLICY tenant_isolation_policy ON employee.onboarding_templates
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.role_competency_map
ALTER TABLE employee.role_competency_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.role_competency_map FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.role_competency_map;
DROP POLICY IF EXISTS tenant_isolation ON employee.role_competency_map;
CREATE POLICY tenant_isolation_policy ON employee.role_competency_map
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.skill_assessments
ALTER TABLE employee.skill_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.skill_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.skill_assessments;
DROP POLICY IF EXISTS tenant_isolation ON employee.skill_assessments;
CREATE POLICY tenant_isolation_policy ON employee.skill_assessments
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.succession_nominees
ALTER TABLE employee.succession_nominees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.succession_nominees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.succession_nominees;
DROP POLICY IF EXISTS tenant_isolation ON employee.succession_nominees;
CREATE POLICY tenant_isolation_policy ON employee.succession_nominees
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.succession_plans
ALTER TABLE employee.succession_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.succession_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.succession_plans;
DROP POLICY IF EXISTS tenant_isolation ON employee.succession_plans;
CREATE POLICY tenant_isolation_policy ON employee.succession_plans
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.survey_responses
ALTER TABLE employee.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.survey_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.survey_responses;
DROP POLICY IF EXISTS tenant_isolation ON employee.survey_responses;
CREATE POLICY tenant_isolation_policy ON employee.survey_responses
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.surveys
ALTER TABLE employee.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.surveys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.surveys;
DROP POLICY IF EXISTS tenant_isolation ON employee.surveys;
CREATE POLICY tenant_isolation_policy ON employee.surveys
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── hrms schema ───────────────────────────────────────────────────

-- hrms.ai_plugin_configs
ALTER TABLE hrms.ai_plugin_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.ai_plugin_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.ai_plugin_configs;
DROP POLICY IF EXISTS tenant_isolation ON hrms.ai_plugin_configs;
CREATE POLICY tenant_isolation_policy ON hrms.ai_plugin_configs
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.ai_prediction_log
ALTER TABLE hrms.ai_prediction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.ai_prediction_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.ai_prediction_log;
DROP POLICY IF EXISTS tenant_isolation ON hrms.ai_prediction_log;
CREATE POLICY tenant_isolation_policy ON hrms.ai_prediction_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.device_activity_log
ALTER TABLE hrms.device_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.device_activity_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.device_activity_log;
DROP POLICY IF EXISTS tenant_isolation ON hrms.device_activity_log;
CREATE POLICY tenant_isolation_policy ON hrms.device_activity_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.device_policies
ALTER TABLE hrms.device_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.device_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.device_policies;
DROP POLICY IF EXISTS tenant_isolation ON hrms.device_policies;
CREATE POLICY tenant_isolation_policy ON hrms.device_policies
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.goal_checkins
ALTER TABLE hrms.goal_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.goal_checkins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.goal_checkins;
DROP POLICY IF EXISTS tenant_isolation ON hrms.goal_checkins;
CREATE POLICY tenant_isolation_policy ON hrms.goal_checkins
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.goals
ALTER TABLE hrms.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.goals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.goals;
DROP POLICY IF EXISTS tenant_isolation ON hrms.goals;
CREATE POLICY tenant_isolation_policy ON hrms.goals
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.id_card_verifications
ALTER TABLE hrms.id_card_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.id_card_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.id_card_verifications;
DROP POLICY IF EXISTS tenant_isolation ON hrms.id_card_verifications;
CREATE POLICY tenant_isolation_policy ON hrms.id_card_verifications
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.id_cards
ALTER TABLE hrms.id_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.id_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.id_cards;
DROP POLICY IF EXISTS tenant_isolation ON hrms.id_cards;
CREATE POLICY tenant_isolation_policy ON hrms.id_cards
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.leaderboard_points
ALTER TABLE hrms.leaderboard_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.leaderboard_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.leaderboard_points;
DROP POLICY IF EXISTS tenant_isolation ON hrms.leaderboard_points;
CREATE POLICY tenant_isolation_policy ON hrms.leaderboard_points
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.leaderboard_totals
ALTER TABLE hrms.leaderboard_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.leaderboard_totals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.leaderboard_totals;
DROP POLICY IF EXISTS tenant_isolation ON hrms.leaderboard_totals;
CREATE POLICY tenant_isolation_policy ON hrms.leaderboard_totals
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.pulse_responses
ALTER TABLE hrms.pulse_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.pulse_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.pulse_responses;
DROP POLICY IF EXISTS tenant_isolation ON hrms.pulse_responses;
CREATE POLICY tenant_isolation_policy ON hrms.pulse_responses
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.pulse_surveys
ALTER TABLE hrms.pulse_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.pulse_surveys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.pulse_surveys;
DROP POLICY IF EXISTS tenant_isolation ON hrms.pulse_surveys;
CREATE POLICY tenant_isolation_policy ON hrms.pulse_surveys
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_social_announcements (FIXED 2026-08-27: was "hrms." — that
-- schema is real for a different group of tables, e.g. hrms.ai_plugin_configs
-- (0021), but this one is created by 0115_social_feed.sql under employee)
ALTER TABLE employee.hrms_social_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_social_announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_social_announcements;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_social_announcements;
CREATE POLICY tenant_isolation_policy ON employee.hrms_social_announcements
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_social_kudos (FIXED 2026-08-27: same "hrms." mistake; also
-- from 0115_social_feed.sql, under employee)
ALTER TABLE employee.hrms_social_kudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_social_kudos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_social_kudos;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_social_kudos;
CREATE POLICY tenant_isolation_policy ON employee.hrms_social_kudos
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.trusted_devices
ALTER TABLE hrms.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.trusted_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.trusted_devices;
DROP POLICY IF EXISTS tenant_isolation ON hrms.trusted_devices;
CREATE POLICY tenant_isolation_policy ON hrms.trusted_devices
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.visiting_cards
ALTER TABLE hrms.visiting_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.visiting_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.visiting_cards;
DROP POLICY IF EXISTS tenant_isolation ON hrms.visiting_cards;
CREATE POLICY tenant_isolation_policy ON hrms.visiting_cards
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── leave schema ──────────────────────────────────────────────────

-- leave.hrms_auto_credit_config
ALTER TABLE leave.hrms_auto_credit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_auto_credit_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_auto_credit_config;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_auto_credit_config;
CREATE POLICY tenant_isolation_policy ON leave.hrms_auto_credit_config
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_blackout_dates
ALTER TABLE leave.hrms_blackout_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_blackout_dates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_blackout_dates;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_blackout_dates;
CREATE POLICY tenant_isolation_policy ON leave.hrms_blackout_dates
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_comp_off_ledger
ALTER TABLE leave.hrms_comp_off_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_comp_off_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_comp_off_ledger;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_comp_off_ledger;
CREATE POLICY tenant_isolation_policy ON leave.hrms_comp_off_ledger
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_holiday_selections
ALTER TABLE leave.hrms_holiday_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_holiday_selections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_holiday_selections;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_holiday_selections;
CREATE POLICY tenant_isolation_policy ON leave.hrms_holiday_selections
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_approval_matrix
ALTER TABLE leave.hrms_leave_approval_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_approval_matrix FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_approval_matrix;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_approval_matrix;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_approval_matrix
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_encashments
ALTER TABLE leave.hrms_leave_encashments ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_encashments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_encashments;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_encashments;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_encashments
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_policy_rules
ALTER TABLE leave.hrms_leave_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_policy_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_policy_rules;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_policy_rules;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_policy_rules
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- leave.hrms_leave_year_config
ALTER TABLE leave.hrms_leave_year_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_year_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_year_config;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_year_config;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_year_config
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── payroll schema (within hrms db) ──────────────────────────────

-- payroll.payroll_slip_templates
ALTER TABLE payroll.payroll_slip_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_slip_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_slip_templates;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_slip_templates;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_slip_templates
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── training schema ───────────────────────────────────────────────

-- training.lms_courses
ALTER TABLE training.lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.lms_courses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON training.lms_courses;
DROP POLICY IF EXISTS tenant_isolation ON training.lms_courses;
CREATE POLICY tenant_isolation_policy ON training.lms_courses
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- training.lms_enrollments
ALTER TABLE training.lms_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.lms_enrollments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON training.lms_enrollments;
DROP POLICY IF EXISTS tenant_isolation ON training.lms_enrollments;
CREATE POLICY tenant_isolation_policy ON training.lms_enrollments
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── Upgrade USING-only policies to USING + WITH CHECK ─────────────

-- employee.hrms_generated_letters (FIXED 2026-08-27: this file called it
-- "hrms_employee_letters", which has never existed anywhere in this
-- service; the real "documents" table from 0009_letters_shifts_fnf.sql is
-- employee.hrms_generated_letters — corrected to match, same as 0122.)
ALTER TABLE employee.hrms_generated_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_generated_letters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_generated_letters;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_generated_letters;
CREATE POLICY tenant_isolation_policy ON employee.hrms_generated_letters
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_fnf_settlements
ALTER TABLE employee.hrms_fnf_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_fnf_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_fnf_settlements;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_fnf_settlements;
CREATE POLICY tenant_isolation_policy ON employee.hrms_fnf_settlements
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_loans
ALTER TABLE employee.hrms_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_loans;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_loans;
CREATE POLICY tenant_isolation_policy ON employee.hrms_loans
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_salary_advances
ALTER TABLE employee.hrms_salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_salary_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_salary_advances;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_salary_advances;
CREATE POLICY tenant_isolation_policy ON employee.hrms_salary_advances
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- claims.hrms_expense_claims (FIXED 2026-08-27: was "hrms."; created by
-- 0115_social_feed.sql under claims)
ALTER TABLE claims.hrms_expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_expense_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON claims.hrms_expense_claims;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_expense_claims;
CREATE POLICY tenant_isolation_policy ON claims.hrms_expense_claims
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.face_embeddings
ALTER TABLE hrms.face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.face_embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.face_embeddings;
DROP POLICY IF EXISTS tenant_isolation ON hrms.face_embeddings;
CREATE POLICY tenant_isolation_policy ON hrms.face_embeddings
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- hrms.face_verification_log
ALTER TABLE hrms.face_verification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.face_verification_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hrms.face_verification_log;
DROP POLICY IF EXISTS tenant_isolation ON hrms.face_verification_log;
CREATE POLICY tenant_isolation_policy ON hrms.face_verification_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- employee.hrms_push_devices (FIXED 2026-08-27: was "hrms."; created by
-- 0115_social_feed.sql under employee)
ALTER TABLE employee.hrms_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_push_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_push_devices;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_push_devices;
CREATE POLICY tenant_isolation_policy ON employee.hrms_push_devices
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- claims.hrms_travel_requests (FIXED 2026-08-27: was "hrms."; created by
-- 0115_social_feed.sql under claims)
ALTER TABLE claims.hrms_travel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_travel_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON claims.hrms_travel_requests;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_travel_requests;
CREATE POLICY tenant_isolation_policy ON claims.hrms_travel_requests
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
