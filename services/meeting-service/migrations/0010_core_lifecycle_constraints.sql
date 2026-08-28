-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0010_core_lifecycle_constraints.sql
-- Service:   meeting-service (gateway /api/v1/meetings) — DB civitas_meeting
--
-- Purpose:
--   Closes the missing CHECK/FK gaps flagged in the core-lifecycle audit
--   (integration-schema-constraints.test.ts). 0001_meeting_core.sql left several
--   enum-shaped columns as plain VARCHAR with no CHECK, and two FK-shaped
--   references (meetings.committee_id/series_id, agenda_items.deferred_to) with
--   no REFERENCES — contrast meetings.parent_meeting_id, which DOES get a real
--   FK two lines above committee_id in the same table. Today only the HTTP/Zod
--   boundary enforces these vocabularies; any other write path (a migration/
--   backfill script, a different service or admin tool with DB credentials, a
--   future consumer bug) can silently write a value Zod would reject, or orphan
--   a meeting/agenda-item reference, and Postgres would not object.
--
--   CHECK allow-lists echo the closed vocabularies already declared in
--   application code 1:1, with ONE deliberate addition: agenda_items.outcome_type
--   also allows 'noting', found (2026-08-26, pre-migration audit query) in active
--   use by tests/minutes-consumer.test.ts's raw fixture INSERT — that value is
--   not in agenda/domain.ts AGENDA_OUTCOME_TYPES, but the constraint is scoped to
--   accommodate what's actually written today rather than break an unrelated,
--   already-passing, out-of-scope test (Migration Safety Rules: a migration that
--   fails a passing consumer is worse than a slightly wider CHECK). Flagged here
--   for a follow-up decision on whether 'noting' belongs in the app-layer enum.
--
--   Pre-migration safety check (2026-08-26, against the shared dev DB this
--   migration also applies to, civitas_meeting on :5435): meetings, participants,
--   agenda_items, and attendance_records were all EMPTY (0 rows) at migration
--   time, and a full grep of every raw-SQL test fixture INSERT across
--   services/meeting-service/tests/ turned up no other out-of-vocabulary value
--   and no orphaned committee_id/series_id/deferred_to reference and no existing
--   check_out_at <= check_in_at row — so every CHECK/FK below applies cleanly
--   with no pre-existing violation to clean up.
--
--   ADDITIVE + IDEMPOTENT: every constraint is guarded by a `pg_constraint`
--   existence check (ADD CONSTRAINT has no IF NOT EXISTS form — same idiom as
--   0001's `room_bookings_no_overlap` EXCLUDE constraint), so the migration can
--   be re-applied safely.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval):
--   ALTER TABLE meeting.meetings         DROP CONSTRAINT IF EXISTS chk_meetings_status,
--     DROP CONSTRAINT IF EXISTS chk_meetings_type,
--     DROP CONSTRAINT IF EXISTS chk_meetings_confidentiality_level,
--     DROP CONSTRAINT IF EXISTS fk_meetings_committee_id,
--     DROP CONSTRAINT IF EXISTS fk_meetings_series_id;
--   ALTER TABLE meeting.participants     DROP CONSTRAINT IF EXISTS chk_participants_role,
--     DROP CONSTRAINT IF EXISTS chk_participants_invitation_status,
--     DROP CONSTRAINT IF EXISTS chk_participants_attendance_mode;
--   ALTER TABLE meeting.agenda_items     DROP CONSTRAINT IF EXISTS chk_agenda_items_status,
--     DROP CONSTRAINT IF EXISTS chk_agenda_items_outcome_type,
--     DROP CONSTRAINT IF EXISTS chk_agenda_items_category,
--     DROP CONSTRAINT IF EXISTS chk_agenda_items_confidentiality_level,
--     DROP CONSTRAINT IF EXISTS fk_agenda_items_deferred_to;
--   ALTER TABLE meeting.attendance_records DROP CONSTRAINT IF EXISTS chk_attendance_method,
--     DROP CONSTRAINT IF EXISTS chk_attendance_mode,
--     DROP CONSTRAINT IF EXISTS chk_attendance_status,
--     DROP CONSTRAINT IF EXISTS chk_attendance_checkout_after_checkin;
--
-- Affected services: meeting-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

DO $$
BEGIN
    -- ── meeting.meetings ────────────────────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_meetings_status') THEN
        ALTER TABLE meeting.meetings
            ADD CONSTRAINT chk_meetings_status CHECK (status IN (
                'draft', 'scheduled', 'agenda_locked', 'in_progress', 'adjourned',
                'minutes_pending', 'minutes_approved', 'closed', 'archived', 'cancelled'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_meetings_type') THEN
        ALTER TABLE meeting.meetings
            ADD CONSTRAINT chk_meetings_type CHECK (type IN (
                'committee', 'board', 'departmental', 'ad_hoc', 'statutory'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_meetings_confidentiality_level') THEN
        ALTER TABLE meeting.meetings
            ADD CONSTRAINT chk_meetings_confidentiality_level CHECK (confidentiality_level IN (
                'public', 'internal', 'confidential', 'secret', 'top_secret'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_meetings_committee_id') THEN
        ALTER TABLE meeting.meetings
            ADD CONSTRAINT fk_meetings_committee_id FOREIGN KEY (committee_id)
                REFERENCES meeting.committees(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_meetings_series_id') THEN
        ALTER TABLE meeting.meetings
            ADD CONSTRAINT fk_meetings_series_id FOREIGN KEY (series_id)
                REFERENCES meeting.meeting_series(id);
    END IF;

    -- ── meeting.participants ────────────────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_participants_role') THEN
        ALTER TABLE meeting.participants
            ADD CONSTRAINT chk_participants_role CHECK (role IN (
                'chairperson', 'member', 'secretary', 'special_invitee', 'observer', 'presenter'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_participants_invitation_status') THEN
        ALTER TABLE meeting.participants
            ADD CONSTRAINT chk_participants_invitation_status CHECK (invitation_status IN (
                'pending', 'accepted', 'tentative', 'declined'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_participants_attendance_mode') THEN
        ALTER TABLE meeting.participants
            ADD CONSTRAINT chk_participants_attendance_mode CHECK (
                attendance_mode IS NULL OR attendance_mode IN ('in_person', 'vc')
            );
    END IF;

    -- ── meeting.agenda_items ────────────────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agenda_items_status') THEN
        ALTER TABLE meeting.agenda_items
            ADD CONSTRAINT chk_agenda_items_status CHECK (status IN (
                'proposed', 'accepted', 'deferred', 'withdrawn', 'carried_forward'
            ));
    END IF;

    -- 'noting' included alongside agenda/domain.ts's AGENDA_OUTCOME_TYPES — see the migration
    -- header comment (pre-existing use in tests/minutes-consumer.test.ts's fixture data).
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agenda_items_outcome_type') THEN
        ALTER TABLE meeting.agenda_items
            ADD CONSTRAINT chk_agenda_items_outcome_type CHECK (outcome_type IN (
                'decision', 'discussion', 'information', 'ratification', 'noting'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agenda_items_category') THEN
        ALTER TABLE meeting.agenda_items
            ADD CONSTRAINT chk_agenda_items_category CHECK (
                category IS NULL OR category IN ('standing', 'arising_from_minutes', 'new_business')
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agenda_items_confidentiality_level') THEN
        ALTER TABLE meeting.agenda_items
            ADD CONSTRAINT chk_agenda_items_confidentiality_level CHECK (confidentiality_level IN (
                'public', 'internal', 'confidential', 'secret', 'top_secret'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agenda_items_deferred_to') THEN
        ALTER TABLE meeting.agenda_items
            ADD CONSTRAINT fk_agenda_items_deferred_to FOREIGN KEY (deferred_to)
                REFERENCES meeting.agenda_items(id);
    END IF;

    -- ── meeting.attendance_records ──────────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_method') THEN
        ALTER TABLE meeting.attendance_records
            ADD CONSTRAINT chk_attendance_method CHECK (method IN (
                'qr', 'biometric', 'geo', 'vc', 'manual'
            ));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_mode') THEN
        ALTER TABLE meeting.attendance_records
            ADD CONSTRAINT chk_attendance_mode CHECK (mode IN ('in_person', 'vc'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_status') THEN
        ALTER TABLE meeting.attendance_records
            ADD CONSTRAINT chk_attendance_status CHECK (status IN (
                'present', 'absent', 'joined_late', 'left_early', 'attending_via_vc'
            ));
    END IF;

    -- Fix 7 companion (attendance/validators.ts now enforces this at the app layer too; this
    -- is the DB-level defense-in-depth backstop — contrast room_bookings, which DOES get a
    -- real EXCLUDE guard for its own invariant while attendance previously got none).
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_checkout_after_checkin') THEN
        ALTER TABLE meeting.attendance_records
            ADD CONSTRAINT chk_attendance_checkout_after_checkin CHECK (
                check_out_at IS NULL OR check_out_at > check_in_at
            );
    END IF;
END $$;
