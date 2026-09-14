-- 0022_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): project-service is tied with
-- asset-service as the worst offender fleet-wide by missing-index count
-- after tranche 1 (works-service + hrms-service). Measured live against a
-- freshly bootstrapped cluster on 2026-09-14 via
-- `node scripts/ci/tenant-index-guard.mjs project`: 32 RLS'd tenant tables
-- in this service, 15 with no index whose leading column is tenant_id,
-- spread across the _outbox/geo/progress/project/scheme/utilisation
-- schemas. This migration is the project-service half of PERF-016's second
-- tranche (asset-service + project-service, 30 of the fleet's remaining 200
-- tables; see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md PERF-016 for the
-- rest).
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranche 1's
-- 0137_perf016_tenant_indexes.sql (hrms-service) -- `status` is the most
-- common tenant-scoped filter fleet-wide (see tenant-index-guard.mjs's own
-- has_tenant_status_composite check).
--
-- Index naming: idx_project_<table>_tenant[_status], reusing the table's
-- own name verbatim when it already carries a project_ prefix (most of
-- this service's tables do: project_geo_tags, project_site_photos,
-- project_dprs, project_financial_progress, project_physical_progress,
-- project_members, project_milestones, project_scheme_dashboard,
-- project_tasks, project_scheme_components) rather than doubling it, and
-- prepending project_ when it does not (baselines, milestone_evidence,
-- task_dependencies, uc_items, messages_legacy) -- same convention
-- tranche 1 used for hrms-service.
--
-- _outbox.messages_legacy is a partitioned-outbox legacy partition that
-- still carries RLS + tenant_id (the live _outbox.messages relay table has
-- its own separate drop-RLS migration, 0020_outbox_messages_drop_rls.sql,
-- which does not touch this legacy partition) -- it has no status column,
-- so it only gets the bare index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an implicit
-- transaction unless the file itself opens one -- this file does not -- so
-- CONCURRENTLY is safe here, matching the precedent in
-- 0019_perf002_tenant_indexes.sql / 0137_perf016_tenant_indexes.sql.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_project_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS geo.idx_project_geo_tags_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS geo.idx_project_site_photos_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS progress.idx_project_dprs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS progress.idx_project_dprs_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS progress.idx_project_financial_progress_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS progress.idx_project_physical_progress_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_baselines_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_milestone_evidence_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_members_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_milestones_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_milestones_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_scheme_dashboard_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_tasks_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_tasks_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS project.idx_project_task_dependencies_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS scheme.idx_project_scheme_components_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS utilisation.idx_project_uc_items_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_geo_tags_tenant
  ON geo.project_geo_tags (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_site_photos_tenant
  ON geo.project_site_photos (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_dprs_tenant
  ON progress.project_dprs (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_dprs_tenant_status
  ON progress.project_dprs (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_financial_progress_tenant
  ON progress.project_financial_progress (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_physical_progress_tenant
  ON progress.project_physical_progress (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_baselines_tenant
  ON project.baselines (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_milestone_evidence_tenant
  ON project.milestone_evidence (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_members_tenant
  ON project.project_members (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_milestones_tenant
  ON project.project_milestones (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_milestones_tenant_status
  ON project.project_milestones (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_scheme_dashboard_tenant
  ON project.project_scheme_dashboard (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_tasks_tenant
  ON project.project_tasks (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_tasks_tenant_status
  ON project.project_tasks (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_task_dependencies_tenant
  ON project.task_dependencies (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_scheme_components_tenant
  ON scheme.project_scheme_components (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_uc_items_tenant
  ON utilisation.project_uc_items (tenant_id);
