-- 0046_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. Tranche 1 (#1192) covered works-service (34) +
-- hrms-service (20); tranche 2 (#1353) covered asset-service (15) +
-- project-service (15). This tranche (3) covers the next two worst
-- offenders by missing-index count -- citizen-service and estab-service,
-- tied at 14 missing each. Re-measured live on 2026-09-16 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped cluster: estab 60 RLS tables / 14 missing -- unchanged
-- from the 2026-09-14 baseline.
--
-- This file is the estab-service half: 14 tables across
-- _outbox/assets/committee/facilities/files/legal with no index whose
-- leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1/2. This
-- service skews heavily toward composites (8 of 14) -- checked directly
-- against live information_schema: assets.estab_vehicle_bookings and all
-- four committee.* tables and all four facilities.* tables carry a status
-- column; the four files.* tables, legal.estab_case_dates, and
-- _outbox.messages_legacy do not.
--
-- Index naming: idx_estab_<table>_tenant[_status], reusing the table's own
-- name verbatim -- every one of these 14 already carries an estab_ prefix
-- except _outbox.messages_legacy, matching tranche 2's asset-service
-- convention for its own messages_legacy table.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranche 1/2's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_estab_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assets.idx_estab_vehicle_bookings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assets.idx_estab_vehicle_bookings_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_attendees_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_committees_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_committees_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_meetings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_meetings_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_resolutions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS committee.idx_estab_resolutions_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_guesthouses_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_guesthouses_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_issues_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_issues_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_room_bookings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_room_bookings_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_rooms_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS facilities.idx_estab_rooms_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS files.idx_estab_file_attachments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS files.idx_estab_file_movements_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS files.idx_estab_notings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS legal.idx_estab_case_dates_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_vehicle_bookings_tenant
  ON assets.estab_vehicle_bookings (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_vehicle_bookings_tenant_status
  ON assets.estab_vehicle_bookings (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_attendees_tenant
  ON committee.estab_attendees (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_committees_tenant
  ON committee.estab_committees (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_committees_tenant_status
  ON committee.estab_committees (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_meetings_tenant
  ON committee.estab_meetings (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_meetings_tenant_status
  ON committee.estab_meetings (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_resolutions_tenant
  ON committee.estab_resolutions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_resolutions_tenant_status
  ON committee.estab_resolutions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_guesthouses_tenant
  ON facilities.estab_guesthouses (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_guesthouses_tenant_status
  ON facilities.estab_guesthouses (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_issues_tenant
  ON facilities.estab_issues (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_issues_tenant_status
  ON facilities.estab_issues (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_room_bookings_tenant
  ON facilities.estab_room_bookings (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_room_bookings_tenant_status
  ON facilities.estab_room_bookings (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_rooms_tenant
  ON facilities.estab_rooms (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_rooms_tenant_status
  ON facilities.estab_rooms (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_attachments_tenant
  ON files.estab_file_attachments (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_file_movements_tenant
  ON files.estab_file_movements (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_notings_tenant
  ON files.estab_notings (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estab_case_dates_tenant
  ON legal.estab_case_dates (tenant_id);
