-- 0012_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. Tranche 1 (#1192) covered works-service (34) +
-- hrms-service (20); tranche 2 (#1353) covered asset-service (15) +
-- project-service (15); tranche 3 (#1393) covered citizen-service (14) +
-- estab-service (14). This tranche (4) covers the next two worst
-- offenders by missing-index count -- meeting-service and revenue-service,
-- 13 and 12 missing respectively (re-measured live on 2026-09-16 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster: meeting 23 RLS tables / 13
-- missing, revenue 22 RLS tables / 12 missing -- both figures already
-- match the gap report's own numbers, unlike citizen/estab in tranche 3).
--
-- This file is the meeting-service half: 13 tables, all in the single
-- `meeting` schema, with no index whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-3
-- (0137_perf016_tenant_indexes.sql hrms-service, 0024 asset-service, 0022
-- project-service, 0034 citizen-service, 0046 estab-service) -- checked
-- directly against this service's live information_schema, not inferred
-- from migration text: agenda_items, attendance_records,
-- committee_members, minutes, room_bookings and vc_sessions carry a
-- status column; action_progress, committee_terms_history,
-- meeting_documents, meeting_state_transitions, minutes_versions,
-- participants and votes do not.
--
-- Index naming: idx_meeting_<table>_tenant[_status], reusing the table's
-- own name verbatim when it already carries a meeting_ prefix (matching
-- tranche 3's convention) rather than doubling it -- meeting_documents and
-- meeting_state_transitions already carry the prefix, so they become
-- idx_meeting_documents_tenant and idx_meeting_state_transitions_tenant,
-- not idx_meeting_meeting_documents_tenant. Every other table in this file
-- gets meeting_ prepended. No bare-name collisions across schemas here --
-- unlike citizen-service in tranche 3 -- since meeting-service keeps all
-- 13 of these tables in the single `meeting` schema.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-3's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_action_progress_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_agenda_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_agenda_items_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_attendance_records_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_attendance_records_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_committee_members_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_committee_members_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_committee_terms_history_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_documents_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_state_transitions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_minutes_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_minutes_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_minutes_versions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_participants_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_room_bookings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_room_bookings_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_vc_sessions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_vc_sessions_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS meeting.idx_meeting_votes_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_action_progress_tenant
  ON meeting.action_progress (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_agenda_items_tenant
  ON meeting.agenda_items (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_agenda_items_tenant_status
  ON meeting.agenda_items (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_attendance_records_tenant
  ON meeting.attendance_records (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_attendance_records_tenant_status
  ON meeting.attendance_records (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_committee_members_tenant
  ON meeting.committee_members (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_committee_members_tenant_status
  ON meeting.committee_members (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_committee_terms_history_tenant
  ON meeting.committee_terms_history (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_documents_tenant
  ON meeting.meeting_documents (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_state_transitions_tenant
  ON meeting.meeting_state_transitions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_minutes_tenant
  ON meeting.minutes (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_minutes_tenant_status
  ON meeting.minutes (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_minutes_versions_tenant
  ON meeting.minutes_versions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_participants_tenant
  ON meeting.participants (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_room_bookings_tenant
  ON meeting.room_bookings (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_room_bookings_tenant_status
  ON meeting.room_bookings (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_vc_sessions_tenant
  ON meeting.vc_sessions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_vc_sessions_tenant_status
  ON meeting.vc_sessions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_votes_tenant
  ON meeting.votes (tenant_id);
