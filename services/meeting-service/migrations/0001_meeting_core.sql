-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0001_meeting_core.sql
-- Service:   meeting-service (port 3033, gateway /api/v1/meetings) — DB civitas_meeting
--
-- Purpose:
--   Initial schema for the meeting-service. Creates the `meeting` PostgreSQL schema
--   with all 21 domain tables (meeting lifecycle, committees, agenda, participants,
--   attendance, minutes, decisions/resolutions, action items, votes, VC sessions,
--   documents, rooms/bookings), plus the transactional outbox (`_outbox.messages`)
--   and consumer-idempotency inbox (`_inbox.processed`). Enables row-level security
--   with per-tenant isolation policies on every tenant-scoped table, creates all
--   read-path indexes (including composite indexes for hot queries), and adds a
--   btree_gist exclusion constraint preventing room double-booking.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, schemas, indexes) or guarded (policies via DROP-then-CREATE,
--   the exclusion constraint via a pg_constraint existence check), so it can be
--   re-applied safely.
--
-- Outbox/inbox alignment:
--   `_outbox.messages` and `_inbox.processed` intentionally match the schema defined
--   by the shared @civitasone/outbox package (which src/shared/outbox.ts re-exports)
--   and the sibling services' 0001 migrations (e.g. finance-service). The service's
--   markProcessed()/enqueue()/relay code targets these exact tables — they are NOT
--   created inside the `meeting` schema.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP SCHEMA IF EXISTS meeting CASCADE;
--   DROP TABLE IF EXISTS _outbox.messages;
--   DROP TABLE IF EXISTS _inbox.processed;
--   -- (Leave the _outbox/_inbox schemas in place; they are shared infra.)
--
-- Affected services: meeting-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS meeting;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES (meeting schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Meeting core ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.meetings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    type                  VARCHAR(32) NOT NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    status                VARCHAR(32) NOT NULL DEFAULT 'draft',
    committee_id          UUID,
    chairperson_id        UUID,
    secretary_id          UUID,
    convener_id           UUID,
    scheduled_at          TIMESTAMPTZ,
    actual_start_at       TIMESTAMPTZ,
    actual_end_at         TIMESTAMPTZ,
    duration_minutes      INTEGER NOT NULL DEFAULT 60,
    venue                 TEXT,
    vc_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    vc_link               TEXT,
    confidentiality_level VARCHAR(16) NOT NULL DEFAULT 'internal',
    parent_meeting_id     UUID REFERENCES meeting.meetings(id),
    series_id             UUID,
    quorum_established    BOOLEAN NOT NULL DEFAULT FALSE,
    quorum_established_at TIMESTAMPTZ,
    adjournment_reason    TEXT,
    next_meeting_date     TIMESTAMPTZ,
    file_reference        TEXT,
    meeting_number        TEXT,
    financial_year        VARCHAR(7),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.meeting_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    code            VARCHAR(32) NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    template_config JSONB,
    is_statutory    BOOLEAN NOT NULL DEFAULT FALSE,
    frequency       VARCHAR(16),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID NOT NULL,
    updated_by      UUID NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.meeting_series (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    committee_id       UUID NOT NULL,
    pattern            VARCHAR(16) NOT NULL,
    day_of_week        INTEGER,
    day_of_month       INTEGER,
    time_of_day        VARCHAR(5),
    duration_minutes   INTEGER NOT NULL DEFAULT 60,
    start_date         DATE NOT NULL,
    end_date           DATE,
    next_instance_date DATE,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL,
    updated_by         UUID NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.meeting_state_transitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    meeting_id      UUID NOT NULL REFERENCES meeting.meetings(id),
    from_state      VARCHAR(32) NOT NULL,
    to_state        VARCHAR(32) NOT NULL,
    reason          TEXT,
    actor_id        UUID NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Committees ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.committees (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL,
    name                    TEXT NOT NULL,
    code                    VARCHAR(32),
    type                    VARCHAR(32) NOT NULL,
    terms_of_reference      TEXT,
    terms_of_reference_url  TEXT,
    constitution_date       DATE NOT NULL,
    tenure_end              DATE,
    parent_body_id          UUID REFERENCES meeting.committees(id),
    constituting_authority  TEXT,
    quorum_rule             JSONB NOT NULL,
    voting_rule             VARCHAR(32) NOT NULL DEFAULT 'simple_majority',
    meeting_frequency       VARCHAR(16),
    statutory_basis         TEXT,
    status                  VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL,
    updated_by              UUID NOT NULL,
    version                 INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.committee_members (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    committee_id         UUID NOT NULL REFERENCES meeting.committees(id),
    member_id            UUID NOT NULL,
    role                 VARCHAR(32) NOT NULL,
    appointment_date     DATE NOT NULL,
    tenure_end           DATE,
    appointing_authority TEXT,
    voting_right         BOOLEAN NOT NULL DEFAULT TRUE,
    status               VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL,
    updated_by           UUID NOT NULL,
    version              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.committee_terms_history (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    committee_id       UUID NOT NULL REFERENCES meeting.committees(id),
    terms_of_reference TEXT NOT NULL,
    effective_date     DATE NOT NULL,
    approved_by        UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Agenda ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.agenda_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    meeting_id            UUID NOT NULL REFERENCES meeting.meetings(id),
    sequence              INTEGER NOT NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    outcome_type          VARCHAR(16) NOT NULL,
    duration_minutes      INTEGER NOT NULL DEFAULT 15,
    presenter_id          UUID,
    status                VARCHAR(16) NOT NULL DEFAULT 'proposed',
    confidentiality_level VARCHAR(16) NOT NULL DEFAULT 'internal',
    linked_decision_id    UUID,
    file_reference        TEXT,
    submitted_by          UUID,
    submitted_at          TIMESTAMPTZ,
    deferred_to           UUID,
    category              VARCHAR(32),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1
);

-- ── Participants ────────────────────────────────────────────────────────────
-- personal_email / personal_phone hold AES-256-GCM ciphertext produced by the
-- app-layer encryptedText() Drizzle type (DPDP Act) — stored as TEXT at rest.

CREATE TABLE IF NOT EXISTS meeting.participants (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    meeting_id        UUID NOT NULL REFERENCES meeting.meetings(id),
    employee_id       UUID NOT NULL,
    role              VARCHAR(32) NOT NULL,
    is_mandatory      BOOLEAN NOT NULL DEFAULT TRUE,
    invitation_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    decline_reason    TEXT,
    attendance_mode   VARCHAR(16),
    nominee_id        UUID,
    agenda_item_ids   JSONB,
    personal_email    TEXT,
    personal_phone    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID NOT NULL,
    updated_by        UUID NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1
);

-- ── Attendance ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.attendance_records (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    meeting_id     UUID NOT NULL REFERENCES meeting.meetings(id),
    participant_id UUID NOT NULL REFERENCES meeting.participants(id),
    method         VARCHAR(16) NOT NULL,
    check_in_at    TIMESTAMPTZ NOT NULL,
    check_out_at   TIMESTAMPTZ,
    mode           VARCHAR(16) NOT NULL DEFAULT 'in_person',
    status         VARCHAR(16) NOT NULL DEFAULT 'present',
    geo_latitude   TEXT,
    geo_longitude  TEXT,
    device_id      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID NOT NULL,
    updated_by     UUID NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1
);

-- ── Minutes ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.minutes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    meeting_id          UUID NOT NULL REFERENCES meeting.meetings(id),
    template_type       VARCHAR(16) NOT NULL DEFAULT 'summary',
    content             TEXT NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'draft',
    current_version     INTEGER NOT NULL DEFAULT 1,
    approved_by         UUID,
    approved_at         TIMESTAMPTZ,
    dsc_signature       TEXT,
    dsc_signer_name     TEXT,
    dsc_signed_at       TIMESTAMPTZ,
    hash_previous       VARCHAR(64),
    hash_current        VARCHAR(64),
    storage_key         TEXT,
    submission_deadline TIMESTAMPTZ,
    ai_generated        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,
    updated_by          UUID NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.minutes_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    minutes_id  UUID NOT NULL REFERENCES meeting.minutes(id),
    version_num INTEGER NOT NULL,
    content     TEXT NOT NULL,
    changed_by  UUID NOT NULL,
    change_note TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Decisions & Resolutions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.decisions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    meeting_id            UUID NOT NULL REFERENCES meeting.meetings(id),
    agenda_item_id        UUID REFERENCES meeting.agenda_items(id),
    text                  TEXT NOT NULL,
    type                  VARCHAR(32) NOT NULL,
    authority             TEXT,
    effective_date        DATE,
    status                VARCHAR(16) NOT NULL DEFAULT 'effective',
    responsible_officer   UUID,
    deadline              TIMESTAMPTZ,
    financial_implication BIGINT,
    currency              VARCHAR(3) DEFAULT 'INR',
    superseded_by_id      UUID,
    linked_decision_ids   JSONB,
    workflow_triggered    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.resolutions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    meeting_id            UUID NOT NULL REFERENCES meeting.meetings(id),
    decision_id           UUID REFERENCES meeting.decisions(id),
    resolution_number     TEXT NOT NULL,
    text                  TEXT NOT NULL,
    vote_type             VARCHAR(16) NOT NULL,
    votes_for             INTEGER NOT NULL DEFAULT 0,
    votes_against         INTEGER NOT NULL DEFAULT 0,
    votes_abstain         INTEGER NOT NULL DEFAULT 0,
    majority_rule         VARCHAR(16) NOT NULL DEFAULT 'simple_majority',
    result                VARCHAR(16) NOT NULL,
    effective_date        DATE,
    dsc_signature         TEXT,
    dsc_signer_name       TEXT,
    dsc_signed_at         TIMESTAMPTZ,
    hash_current          VARCHAR(64),
    storage_key           TEXT,
    status                VARCHAR(16) NOT NULL DEFAULT 'effective',
    is_circulation        BOOLEAN NOT NULL DEFAULT FALSE,
    circulation_deadline  TIMESTAMPTZ,
    response_rate         INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1
);

-- ── Action Items ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.action_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    meeting_id         UUID NOT NULL REFERENCES meeting.meetings(id),
    decision_id        UUID REFERENCES meeting.decisions(id),
    agenda_item_id     UUID REFERENCES meeting.agenda_items(id),
    description        TEXT NOT NULL,
    assignee_id        UUID NOT NULL,
    deadline           TIMESTAMPTZ NOT NULL,
    priority           VARCHAR(8) NOT NULL DEFAULT 'medium',
    sla_hours          INTEGER,
    escalation_level   INTEGER NOT NULL DEFAULT 0,
    status             VARCHAR(16) NOT NULL DEFAULT 'assigned',
    evidence_url       TEXT,
    evidence_note      TEXT,
    verified_by        UUID,
    verified_at        TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    acknowledged_at    TIMESTAMPTZ,
    overdue_at         TIMESTAMPTZ,
    next_escalation_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL,
    updated_by         UUID NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.action_progress (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    action_item_id UUID NOT NULL REFERENCES meeting.action_items(id),
    update_text    TEXT NOT NULL,
    percentage     INTEGER NOT NULL DEFAULT 0,
    updated_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Votes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.votes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    resolution_id  UUID NOT NULL REFERENCES meeting.resolutions(id),
    member_id      UUID NOT NULL,
    position       VARCHAR(8) NOT NULL,
    reason         TEXT,
    voted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_circulation BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── VC Sessions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.vc_sessions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    meeting_id            UUID NOT NULL REFERENCES meeting.meetings(id),
    provider              VARCHAR(16) NOT NULL,
    external_id           TEXT,
    join_url              TEXT,
    dial_in_number        TEXT,
    meeting_pin           TEXT,
    recording_url         TEXT,
    recording_storage_key TEXT,
    status                VARCHAR(16) NOT NULL DEFAULT 'created',
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,
    failure_reason        TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1
);

-- ── Documents ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.meeting_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    meeting_id          UUID NOT NULL REFERENCES meeting.meetings(id),
    agenda_item_id      UUID REFERENCES meeting.agenda_items(id),
    file_name           TEXT NOT NULL,
    mime_type           VARCHAR(128) NOT NULL,
    file_size_bytes     BIGINT,
    storage_key         TEXT NOT NULL,
    hash                VARCHAR(64) NOT NULL,
    classification      VARCHAR(16) NOT NULL DEFAULT 'internal',
    document_type       VARCHAR(32),
    version_num         INTEGER NOT NULL DEFAULT 1,
    previous_version_id UUID,
    retention_years     INTEGER NOT NULL DEFAULT 5,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,
    updated_by          UUID NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1
);

-- ── Rooms & Calendar ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting.rooms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    name          TEXT NOT NULL,
    capacity      INTEGER NOT NULL,
    location      TEXT,
    floor         VARCHAR(8),
    building      TEXT,
    equipment     JSONB,
    accessibility BOOLEAN NOT NULL DEFAULT FALSE,
    status        VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID NOT NULL,
    updated_by    UUID NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meeting.room_bookings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    room_id    UUID NOT NULL REFERENCES meeting.rooms(id),
    meeting_id UUID NOT NULL REFERENCES meeting.meetings(id),
    start_at   TIMESTAMPTZ NOT NULL,
    end_at     TIMESTAMPTZ NOT NULL,
    status     VARCHAR(16) NOT NULL DEFAULT 'confirmed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRANSACTIONAL OUTBOX + CONSUMER-IDEMPOTENCY INBOX
--   Schema matches @civitasone/outbox (re-exported by src/shared/outbox.ts) and the
--   sibling services' 0001 migrations. The relay scans across tenants, so these
--   tables are intentionally NOT tenant-scoped and have NO row-level security.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS _outbox.messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic          VARCHAR(128) NOT NULL,
    event_type     VARCHAR(128) NOT NULL,
    tenant_id      UUID NOT NULL,
    actor_id       UUID NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    payload        JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);

-- Hot path for the relay: fetch unpublished rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
    ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
    message_id   UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the scheduled purge of old idempotency records.
CREATE INDEX IF NOT EXISTS idx_inbox_processed_time
    ON _inbox.processed(processed_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation)
--   Every tenant-scoped table has RLS enabled with a policy restricting all rows to
--   the tenant in the app.tenant_id GUC (set per-transaction by shared/db.ts via
--   set_config('app.tenant_id', ...)). A USING-only policy also governs INSERT/UPDATE
--   WITH CHECK (Postgres reuses the USING expression), so writes cannot cross tenants.
--   Policies are dropped-then-created for idempotent re-runs (CREATE POLICY has no
--   IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE meeting.meetings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_series            ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.committees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.committee_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.committee_terms_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.agenda_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.participants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.attendance_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.minutes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.minutes_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.decisions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.resolutions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.action_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.action_progress           ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.votes                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.vc_sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.meeting_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.rooms                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.room_bookings             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_tenant ON meeting.meetings;
CREATE POLICY meetings_tenant ON meeting.meetings
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS meeting_types_tenant ON meeting.meeting_types;
CREATE POLICY meeting_types_tenant ON meeting.meeting_types
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS meeting_series_tenant ON meeting.meeting_series;
CREATE POLICY meeting_series_tenant ON meeting.meeting_series
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS transitions_tenant ON meeting.meeting_state_transitions;
CREATE POLICY transitions_tenant ON meeting.meeting_state_transitions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS committees_tenant ON meeting.committees;
CREATE POLICY committees_tenant ON meeting.committees
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS committee_members_tenant ON meeting.committee_members;
CREATE POLICY committee_members_tenant ON meeting.committee_members
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS terms_history_tenant ON meeting.committee_terms_history;
CREATE POLICY terms_history_tenant ON meeting.committee_terms_history
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS agenda_items_tenant ON meeting.agenda_items;
CREATE POLICY agenda_items_tenant ON meeting.agenda_items
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS participants_tenant ON meeting.participants;
CREATE POLICY participants_tenant ON meeting.participants
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS attendance_tenant ON meeting.attendance_records;
CREATE POLICY attendance_tenant ON meeting.attendance_records
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS minutes_tenant ON meeting.minutes;
CREATE POLICY minutes_tenant ON meeting.minutes
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS minutes_versions_tenant ON meeting.minutes_versions;
CREATE POLICY minutes_versions_tenant ON meeting.minutes_versions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS decisions_tenant ON meeting.decisions;
CREATE POLICY decisions_tenant ON meeting.decisions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS resolutions_tenant ON meeting.resolutions;
CREATE POLICY resolutions_tenant ON meeting.resolutions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS action_items_tenant ON meeting.action_items;
CREATE POLICY action_items_tenant ON meeting.action_items
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS action_progress_tenant ON meeting.action_progress;
CREATE POLICY action_progress_tenant ON meeting.action_progress
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS votes_tenant ON meeting.votes;
CREATE POLICY votes_tenant ON meeting.votes
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS vc_sessions_tenant ON meeting.vc_sessions;
CREATE POLICY vc_sessions_tenant ON meeting.vc_sessions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS documents_tenant ON meeting.meeting_documents;
CREATE POLICY documents_tenant ON meeting.meeting_documents
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS rooms_tenant ON meeting.rooms;
CREATE POLICY rooms_tenant ON meeting.rooms
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS room_bookings_tenant ON meeting.room_bookings;
CREATE POLICY room_bookings_tenant ON meeting.room_bookings
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. Composite indexes
--   back the hot list/filter queries (tenant + status/committee/date, meeting +
--   sequence, etc.). All are IF NOT EXISTS for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Meetings
CREATE INDEX IF NOT EXISTS idx_meetings_tenant           ON meeting.meetings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meetings_tenant_status    ON meeting.meetings(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_tenant_committee ON meeting.meetings(tenant_id, committee_id);
CREATE INDEX IF NOT EXISTS idx_meetings_tenant_scheduled ON meeting.meetings(tenant_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_series           ON meeting.meetings(series_id);

-- Meeting Types
CREATE INDEX IF NOT EXISTS idx_meeting_types_tenant             ON meeting.meeting_types(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_types_tenant_code ON meeting.meeting_types(tenant_id, code);

-- Series
CREATE INDEX IF NOT EXISTS idx_series_tenant_committee ON meeting.meeting_series(tenant_id, committee_id);

-- Transitions
CREATE INDEX IF NOT EXISTS idx_transitions_meeting ON meeting.meeting_state_transitions(meeting_id);

-- Committees
CREATE INDEX IF NOT EXISTS idx_committees_tenant             ON meeting.committees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_committees_tenant_status      ON meeting.committees(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_committees_tenant_code ON meeting.committees(tenant_id, code) WHERE code IS NOT NULL;

-- Committee Members
CREATE INDEX IF NOT EXISTS idx_cmembers_committee     ON meeting.committee_members(committee_id);
CREATE INDEX IF NOT EXISTS idx_cmembers_member        ON meeting.committee_members(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmembers_active ON meeting.committee_members(committee_id, member_id) WHERE status = 'active';

-- Agenda
CREATE INDEX IF NOT EXISTS idx_agenda_meeting     ON meeting.agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_agenda_meeting_seq ON meeting.agenda_items(meeting_id, sequence);

-- Participants
CREATE INDEX IF NOT EXISTS idx_participants_meeting     ON meeting.participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_participants_employee    ON meeting.participants(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_unique ON meeting.participants(meeting_id, employee_id);

-- Attendance
CREATE INDEX IF NOT EXISTS idx_attendance_meeting      ON meeting.attendance_records(meeting_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON meeting.attendance_records(meeting_id, participant_id);

-- Minutes
CREATE INDEX IF NOT EXISTS idx_minutes_meeting  ON meeting.minutes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_minutes_versions ON meeting.minutes_versions(minutes_id);

-- Decisions
CREATE INDEX IF NOT EXISTS idx_decisions_meeting ON meeting.decisions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type    ON meeting.decisions(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_decisions_officer ON meeting.decisions(responsible_officer);

-- Resolutions
CREATE INDEX IF NOT EXISTS idx_resolutions_meeting       ON meeting.resolutions(meeting_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolutions_number ON meeting.resolutions(tenant_id, meeting_id, resolution_number);

-- Action Items
CREATE INDEX IF NOT EXISTS idx_actions_meeting  ON meeting.action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_actions_assignee ON meeting.action_items(assignee_id);
CREATE INDEX IF NOT EXISTS idx_actions_status   ON meeting.action_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_actions_deadline ON meeting.action_items(deadline)
    WHERE status NOT IN ('completed', 'verified', 'withdrawn');
CREATE INDEX IF NOT EXISTS idx_progress_item    ON meeting.action_progress(action_item_id);

-- Votes
CREATE INDEX IF NOT EXISTS idx_votes_resolution   ON meeting.votes(resolution_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique ON meeting.votes(resolution_id, member_id);

-- VC Sessions
CREATE INDEX IF NOT EXISTS idx_vc_meeting ON meeting.vc_sessions(meeting_id);

-- Documents
CREATE INDEX IF NOT EXISTS idx_docs_meeting ON meeting.meeting_documents(meeting_id);
CREATE INDEX IF NOT EXISTS idx_docs_agenda  ON meeting.meeting_documents(agenda_item_id);

-- Rooms & Bookings
CREATE INDEX IF NOT EXISTS idx_rooms_tenant  ON meeting.rooms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON meeting.room_bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_time ON meeting.room_bookings(room_id, start_at, end_at)
    WHERE status = 'confirmed';

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSTRAINTS
--   Room double-booking prevention via a btree_gist exclusion constraint: no two
--   'confirmed' bookings for the same room may have overlapping [start_at, end_at)
--   ranges. Guarded by a pg_constraint existence check so re-runs are idempotent
--   (ADD CONSTRAINT has no IF NOT EXISTS form).
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'room_bookings_no_overlap'
    ) THEN
        ALTER TABLE meeting.room_bookings
            ADD CONSTRAINT room_bookings_no_overlap
            EXCLUDE USING gist (
                room_id WITH =,
                tstzrange(start_at, end_at) WITH &&
            ) WHERE (status = 'confirmed');
    END IF;
END $$;
