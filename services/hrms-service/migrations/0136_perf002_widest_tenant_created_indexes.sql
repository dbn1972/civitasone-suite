-- 0136_perf002_widest_tenant_created_indexes.sql
-- PERF-002: 0/12 of the fleet's widest tenant tables (by column count) had a
-- (tenant_id, created_at) composite index, the shape most list/audit/report
-- queries filter and sort by. hrms-service holds 9 of the 12 (verified
-- against the live dev cluster on 2026-09-08); each already has a leading
-- tenant_id index (hrms-service RLS migrations created those earlier), so
-- this is additive-only, no new leading index needed here.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block; safe
-- under this repo's migration runner (see finance-service
-- 0071_perf002_tenant_indexes.sql for the detailed rationale).
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_employees_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_hrms_assessment_attempts_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS recruitment.idx_hrms_applications_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS recruitment.idx_hrms_job_openings_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS recruitment.idx_hrms_offers_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS candidate.idx_hrms_candidates_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS recruitment.idx_hrms_requisitions_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS agency.idx_hrms_contractor_bills_tenant_created;
--   DROP INDEX CONCURRENTLY IF EXISTS leave.idx_hrms_leave_policy_rules_tenant_created;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_tenant_created
  ON employee.hrms_employees (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_assessment_attempts_tenant_created
  ON assessment.hrms_assessment_attempts (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_applications_tenant_created
  ON recruitment.hrms_applications (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_job_openings_tenant_created
  ON recruitment.hrms_job_openings (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_offers_tenant_created
  ON recruitment.hrms_offers (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_candidates_tenant_created
  ON candidate.hrms_candidates (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_requisitions_tenant_created
  ON recruitment.hrms_requisitions (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_contractor_bills_tenant_created
  ON agency.hrms_contractor_bills (tenant_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_policy_rules_tenant_created
  ON leave.hrms_leave_policy_rules (tenant_id, created_at);
