-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0005_meeting_rls_force
-- Service:   meeting-service — DB civitas_meeting (schema `meeting`)
--
-- Purpose (P0 SECURITY — cross-tenant leak):
--   Close a proven cross-tenant data leak. In 0001_meeting_core.sql every
--   tenant-scoped table got ENABLE ROW LEVEL SECURITY but NOT `FORCE`, and the
--   application role meeting_svc OWNS those tables. A table owner BYPASSES RLS
--   unless FORCE is set, so meeting_svc (the role the service connects as) saw
--   EVERY tenant's rows — RLS was inert on the real code path.
--
--   Additionally the original tenant_isolation policies used the FAIL-OPEN GUC
--   form `current_setting('app.tenant_id')::uuid` which RAISES on an unset GUC
--   (latent outage) rather than failing closed.
--
--   This migration, mirroring court-service/migrations/0001_court_core.sql:
--     (1) ALTER TABLE ... FORCE ROW LEVEL SECURITY on every meeting.* base table,
--         so even the owning role meeting_svc is subject to the policy; and
--     (2) drops + recreates each table's existing tenant policy (reusing its
--         current name) to the FAIL-CLOSED missing-ok form
--         `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`
--         so an UNSET app.tenant_id yields NULL → no rows (fail-closed), and the
--         USING expression also governs INSERT/UPDATE WITH CHECK (Postgres reuses
--         USING for ALL-command policies), so writes cannot cross tenants either.
--
--   REQUIRED companion change: the meeting worker now wraps every consumer
--   handler in `runWithTenant(msg.tenantId, ...)` so the app.tenant_id GUC is set
--   on the write path — without it, consumer writes would fail closed after FORCE.
--
-- Safety:  ADDITIVE + IDEMPOTENT. FORCE is a catalog flag (instant, brief lock;
--          lock_timeout bounds any wait). Policies are DROP IF EXISTS then CREATE
--          for safe re-runs (CREATE POLICY has no IF NOT EXISTS).
-- Rollback (DESTRUCTIVE — re-opens the leak; requires DBA approval): reset each
--          table to NO FORCE and restore the fail-open policy form. Not provided
--          as an automatic down-migration.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';

-- (1) FORCE row-level security so the owning role (meeting_svc) is subject to RLS.
ALTER TABLE meeting.action_items                FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.action_progress             FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.agenda_items                FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.attendance_records          FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.committee_members           FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.committee_terms_history     FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.committees                  FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.decisions                   FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_documents           FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_series              FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_state_transitions   FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_types               FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.meetings                    FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.minutes                     FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.minutes_versions            FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.participants                FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.resolutions                 FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.room_bookings               FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.rooms                       FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.vc_sessions                 FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting.votes                       FORCE ROW LEVEL SECURITY;

-- (2) Recreate each tenant policy to the FAIL-CLOSED missing-ok form. Policy names
--     reused exactly as they exist today (pg_policies). USING governs read; for an
--     ALL-command policy Postgres reuses USING as the INSERT/UPDATE WITH CHECK.
DROP POLICY IF EXISTS action_items_tenant ON meeting.action_items;
CREATE POLICY action_items_tenant ON meeting.action_items
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS action_progress_tenant ON meeting.action_progress;
CREATE POLICY action_progress_tenant ON meeting.action_progress
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS agenda_items_tenant ON meeting.agenda_items;
CREATE POLICY agenda_items_tenant ON meeting.agenda_items
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS attendance_tenant ON meeting.attendance_records;
CREATE POLICY attendance_tenant ON meeting.attendance_records
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS committee_members_tenant ON meeting.committee_members;
CREATE POLICY committee_members_tenant ON meeting.committee_members
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS terms_history_tenant ON meeting.committee_terms_history;
CREATE POLICY terms_history_tenant ON meeting.committee_terms_history
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS committees_tenant ON meeting.committees;
CREATE POLICY committees_tenant ON meeting.committees
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS decisions_tenant ON meeting.decisions;
CREATE POLICY decisions_tenant ON meeting.decisions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS documents_tenant ON meeting.meeting_documents;
CREATE POLICY documents_tenant ON meeting.meeting_documents
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS meeting_series_tenant ON meeting.meeting_series;
CREATE POLICY meeting_series_tenant ON meeting.meeting_series
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS transitions_tenant ON meeting.meeting_state_transitions;
CREATE POLICY transitions_tenant ON meeting.meeting_state_transitions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS meeting_types_tenant ON meeting.meeting_types;
CREATE POLICY meeting_types_tenant ON meeting.meeting_types
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS meetings_tenant ON meeting.meetings;
CREATE POLICY meetings_tenant ON meeting.meetings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS minutes_tenant ON meeting.minutes;
CREATE POLICY minutes_tenant ON meeting.minutes
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS minutes_versions_tenant ON meeting.minutes_versions;
CREATE POLICY minutes_versions_tenant ON meeting.minutes_versions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS participants_tenant ON meeting.participants;
CREATE POLICY participants_tenant ON meeting.participants
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS resolutions_tenant ON meeting.resolutions;
CREATE POLICY resolutions_tenant ON meeting.resolutions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS room_bookings_tenant ON meeting.room_bookings;
CREATE POLICY room_bookings_tenant ON meeting.room_bookings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS rooms_tenant ON meeting.rooms;
CREATE POLICY rooms_tenant ON meeting.rooms
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS vc_sessions_tenant ON meeting.vc_sessions;
CREATE POLICY vc_sessions_tenant ON meeting.vc_sessions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS votes_tenant ON meeting.votes;
CREATE POLICY votes_tenant ON meeting.votes
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
