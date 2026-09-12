-- 0137_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): hrms-service is the second-worst
-- offender fleet-wide by missing-index count. Measured live against a
-- freshly bootstrapped cluster on 2026-09-12 via
-- `node scripts/ci/tenant-index-guard.mjs --report`: 209 RLS'd tenant
-- tables fleet-wide in this service, 20 with no index whose leading
-- column is tenant_id, spread across the employee/appraisal/attendance/
-- competency/leave/lifecycle/payroll/hrms/_outbox schemas. This migration
-- is the hrms-service half of PERF-016's first tranche (works-service +
-- hrms-service, 54 of the fleet's 254 remaining tables; see
-- docs/ENTERPRISE-GAP-REPORT-2026-09-07.md PERF-016 for the rest).
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and finance-service's
-- 0071_perf002_tenant_indexes.sql — `status` is the most common
-- tenant-scoped filter fleet-wide (see tenant-index-guard.mjs's own
-- has_tenant_status_composite check). No (tenant_id, created_at)
-- composites here: that shape was scoped to the original evidence's "12
-- widest tables by column count" sub-goal, already covered for this
-- service by 0136_perf002_widest_tenant_created_indexes.sql, not part of
-- PERF-016's DoD (0 tables with no leading tenant_id index).
--
-- _outbox.messages_legacy is a partitioned-outbox legacy partition that
-- still carries RLS + tenant_id (unlike works-service, which dropped RLS
-- from its outbox tables in 0014_outbox_messages_drop_rls.sql) — it has no
-- status column, so it only gets the bare index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one — this file does
-- not — so CONCURRENTLY is safe here, matching the precedent in
-- 0019_perf002_tenant_indexes.sql / 0136_perf002_widest_tenant_created_indexes.sql.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_hrms_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS appraisal.idx_hrms_calibration_sessions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS appraisal.idx_hrms_calibration_sessions_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS attendance.idx_hrms_overtime_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS attendance.idx_hrms_overtime_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS competency.idx_hrms_frameworks_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS competency.idx_hrms_frameworks_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_compensation_recommendations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_compensation_recommendations_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_feedback_cycles_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_feedback_cycles_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_employee_docs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_fnf_settlements_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_fnf_settlements_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_generated_letters_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_import_batches_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_import_batches_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_ml_runs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_ml_runs_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_recommendations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_surveys_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_surveys_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS hrms.idx_hrms_goal_checkins_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS hrms.idx_hrms_pulse_responses_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS leave.idx_hrms_leave_approval_matrix_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS leave.idx_hrms_leave_encashments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS leave.idx_hrms_leave_encashments_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_hrms_promotions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_hrms_promotions_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_hrms_transfers_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_hrms_transfers_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_hrms_payroll_slip_templates_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_calibration_sessions_tenant
  ON appraisal.hrms_calibration_sessions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_calibration_sessions_tenant_status
  ON appraisal.hrms_calibration_sessions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_overtime_tenant
  ON attendance.hrms_overtime (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_overtime_tenant_status
  ON attendance.hrms_overtime (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_frameworks_tenant
  ON competency.frameworks (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_frameworks_tenant_status
  ON competency.frameworks (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_compensation_recommendations_tenant
  ON employee.compensation_recommendations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_compensation_recommendations_tenant_status
  ON employee.compensation_recommendations (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_feedback_cycles_tenant
  ON employee.feedback_cycles (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_feedback_cycles_tenant_status
  ON employee.feedback_cycles (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employee_docs_tenant
  ON employee.hrms_employee_docs (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_fnf_settlements_tenant
  ON employee.hrms_fnf_settlements (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_fnf_settlements_tenant_status
  ON employee.hrms_fnf_settlements (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_generated_letters_tenant
  ON employee.hrms_generated_letters (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_import_batches_tenant
  ON employee.hrms_import_batches (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_import_batches_tenant_status
  ON employee.hrms_import_batches (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_ml_runs_tenant
  ON employee.hrms_ml_runs (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_ml_runs_tenant_status
  ON employee.hrms_ml_runs (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_recommendations_tenant
  ON employee.hrms_recommendations (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_surveys_tenant
  ON employee.surveys (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_surveys_tenant_status
  ON employee.surveys (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_goal_checkins_tenant
  ON hrms.goal_checkins (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_pulse_responses_tenant
  ON hrms.pulse_responses (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_approval_matrix_tenant
  ON leave.hrms_leave_approval_matrix (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_encashments_tenant
  ON leave.hrms_leave_encashments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_encashments_tenant_status
  ON leave.hrms_leave_encashments (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_promotions_tenant
  ON lifecycle.hrms_promotions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_promotions_tenant_status
  ON lifecycle.hrms_promotions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_transfers_tenant
  ON lifecycle.hrms_transfers (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_transfers_tenant_status
  ON lifecycle.hrms_transfers (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_payroll_slip_templates_tenant
  ON payroll.payroll_slip_templates (tenant_id);
