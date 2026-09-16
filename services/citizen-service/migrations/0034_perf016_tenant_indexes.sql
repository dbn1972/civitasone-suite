-- 0034_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. Tranche 1 (#1192) covered works-service (34) +
-- hrms-service (20); tranche 2 (#1353) covered asset-service (15) +
-- project-service (15). This tranche (3) covers the next two worst
-- offenders by missing-index count -- citizen-service and estab-service,
-- tied at 14 missing each. (The gap report's "citizen 43, estab 60"
-- figures are each service's TOTAL RLS tenant-table count, not its
-- violation count -- re-measured live on 2026-09-16 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped cluster: citizen 43 RLS tables / 14 missing, estab 60 RLS
-- tables / 14 missing -- unchanged from the 2026-09-14 baseline, and
-- still tied for the largest tracked backlog.)
--
-- This file is the citizen-service half: 14 tables across
-- _outbox/analytics/appeal/application/citizen/grievance/helpdesk/
-- issuance/portal/rti with no index whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1/2
-- (0137_perf016_tenant_indexes.sql hrms-service,
-- 0024_perf016_tenant_indexes.sql asset-service) -- `status` is the most
-- common tenant-scoped filter fleet-wide (see tenant-index-guard.mjs's own
-- has_tenant_status_composite check). Checked directly against this
-- service's live information_schema rather than inferred from migration
-- text, since two of these 14 tables share a bare table name across
-- schemas (citizen.citizen_escalations and grievance.citizen_escalations
-- are different tables): only grievance.citizen_escalations and
-- rti.citizen_rti_appeals carry a status column.
--
-- _outbox.messages_legacy is the same partitioned-outbox legacy partition
-- shape already seen in tranche 2's asset-service migration -- no status
-- column, bare index only.
--
-- Index naming: idx_citizen_<table>_tenant[_status], reusing the table's
-- own name verbatim when it already carries a citizen_ prefix (matching
-- tranche 2's asset-service convention) rather than doubling it, and
-- prepending citizen_ when it does not (hearings, certificate_events).
-- citizen.citizen_escalations and grievance.citizen_escalations both
-- produce idx_citizen_escalations_tenant, which is not a collision: an
-- index is created in the same schema as its table, so
-- citizen.idx_citizen_escalations_tenant and
-- grievance.idx_citizen_escalations_tenant are distinct relations.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranche 1/2's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_citizen_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS analytics.idx_citizen_delivery_metrics_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS appeal.idx_citizen_hearings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS application.idx_citizen_app_documents_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS application.idx_citizen_status_history_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS citizen.idx_citizen_escalations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS citizen.idx_citizen_sla_escalation_rules_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS grievance.idx_citizen_escalations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS grievance.idx_citizen_escalations_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS grievance.idx_citizen_grievance_actions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_citizen_ticket_notes_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS issuance.idx_citizen_certificate_events_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS portal.idx_citizen_profiles_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS rti.idx_citizen_rti_appeals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS rti.idx_citizen_rti_appeals_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS rti.idx_citizen_rti_responses_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_delivery_metrics_tenant
  ON analytics.citizen_delivery_metrics (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_hearings_tenant
  ON appeal.hearings (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_app_documents_tenant
  ON application.citizen_app_documents (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_status_history_tenant
  ON application.citizen_status_history (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_escalations_tenant
  ON citizen.citizen_escalations (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_sla_escalation_rules_tenant
  ON citizen.sla_escalation_rules (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_escalations_tenant
  ON grievance.citizen_escalations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_escalations_tenant_status
  ON grievance.citizen_escalations (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_grievance_actions_tenant
  ON grievance.citizen_grievance_actions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_ticket_notes_tenant
  ON helpdesk.citizen_ticket_notes (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_certificate_events_tenant
  ON issuance.certificate_events (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_profiles_tenant
  ON portal.citizen_profiles (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_rti_appeals_tenant
  ON rti.citizen_rti_appeals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_rti_appeals_tenant_status
  ON rti.citizen_rti_appeals (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_rti_responses_tenant
  ON rti.citizen_rti_responses (tenant_id);
