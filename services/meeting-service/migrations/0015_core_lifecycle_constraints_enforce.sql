-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0015_core_lifecycle_constraints_enforce.sql
-- Service:   meeting-service — DB civitas_meeting
--
-- UAT F100: none of the 17 CHECK/FK constraints from 0010_core_lifecycle_constraints.sql
-- exist on live UAT. 0010 is one DO block; on UAT it hit rows that violate two of its
-- constraints, the whole block rolled back, and the tolerant deploy runner hid the error.
-- 0010 also guards each constraint by NAME ONLY across the whole database, so it can
-- report success while creating nothing.
--
-- Blocking rows found on UAT (SELECT only, 2026-10-31):
--   - 1 meeting whose committee does not exist, a test-runner row:
--       id baa2a61c-5794-3424-5339-7ddd1f8380f7, title FQ9-RUNNER-mtg-4e4202,
--       tenant 11111111-0000-0000-0000-000000000001,
--       committee_id 58542851-76e8-430a-ad5a-7f437397e9f1 (no such committee).
--   - 39 attendance_records with check_out_at <= check_in_at (check-ins 2026-08-26 to
--     2026-09-12).
--
-- This migration:
--   1. Archives the FQ9-RUNNER test meeting (test_data_archived_at, the flag 0014 adds;
--      added here too IF NOT EXISTS so this file does not depend on 0014's merge order).
--   2. Clears dangling references so the FKs can be validated. Exact predicate: the
--      referenced row does not exist. Only committee_id matches on UAT (the row above);
--      series_id and deferred_to have 0 orphans and are included so the FKs can never
--      be blocked the same way. The columns are nullable and a NULL committee/series/
--      successor is a state the app already handles.
--   3. Sets check_out_at = NULL where check_out_at <= check_in_at (39 rows on UAT). A
--      check-out at or before the check-in is impossible; NULL means "not checked out",
--      which is what the CHECK allows.
--   4. Adds the 17 constraints of 0010 with a REAL existence check: the constraint must
--      exist ON THAT TABLE, with that name and type AND the same definition. A
--      same-named constraint with a different definition raises (never silently
--      skipped). Missing ones are added NOT VALID and then VALIDATEd; an existing NOT
--      VALID one is VALIDATEd.
--
-- Rows changed on UAT (from SELECTs, 2026-10-31): meetings 1 (archived + committee
-- nulled), attendance_records 39. Fresh / CI databases: 0 rows, all constraints already
-- exist from 0010 and are validated, so this file is a no-op there.
--
-- Idempotent: every UPDATE is predicate-scoped and matches nothing on a re-run; every
-- constraint step is guarded as above.
--
-- RLS: the per-service runner applies this as the table OWNER (meeting_svc, NOBYPASSRLS)
-- and these tables are FORCE RLS, so UPDATEs without a tenant would see no rows. FORCE is
-- lifted for the repair UPDATEs and restored in the same transaction (house idiom, see
-- 0014). Constraint validation is not subject to RLS.
--
-- Preview on UAT (SELECT only):
--   SELECT count(*) FROM meeting.meetings m WHERE committee_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM meeting.committees c WHERE c.id = m.committee_id);
--   SELECT count(*) FROM meeting.attendance_records
--    WHERE check_out_at IS NOT NULL AND check_out_at <= check_in_at;
--
-- Rollback: see 0010's header (DROP CONSTRAINT IF EXISTS ...). The data repairs are not
-- reversed; the original values of the 39 check-outs and the 1 committee id are listed by
-- the preview queries above until this migration runs.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE meeting.meetings ADD COLUMN IF NOT EXISTS test_data_archived_at TIMESTAMPTZ;

-- ── 1-3. Repair the blocking rows ────────────────────────────────────────────────
DO $$
DECLARE
  t     text;
  n     bigint;
  -- committees and meeting_series are only READ (orphan checks), but under FORCE RLS the
  -- owner would see none of their rows and every reference would look dangling.
  tbls  text[] := ARRAY['meeting.meetings', 'meeting.agenda_items', 'meeting.attendance_records',
                        'meeting.committees', 'meeting.meeting_series'];
  forced text[] := '{}';
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', t);
      forced := forced || t;
    END IF;
  END LOOP;

  UPDATE meeting.meetings
     SET test_data_archived_at = now()
   WHERE id = 'baa2a61c-5794-3424-5339-7ddd1f8380f7'
     AND title LIKE 'FQ9-RUNNER-%'
     AND test_data_archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: archived % FQ9-RUNNER test meeting(s)', n;

  UPDATE meeting.meetings m
     SET committee_id = NULL, updated_at = now()
   WHERE m.committee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.committees c WHERE c.id = m.committee_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: cleared % dangling meetings.committee_id', n;

  UPDATE meeting.meetings m
     SET series_id = NULL, updated_at = now()
   WHERE m.series_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.meeting_series s WHERE s.id = m.series_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: cleared % dangling meetings.series_id', n;

  UPDATE meeting.agenda_items a
     SET deferred_to = NULL, updated_at = now()
   WHERE a.deferred_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.agenda_items s WHERE s.id = a.deferred_to);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: cleared % dangling agenda_items.deferred_to', n;

  UPDATE meeting.attendance_records
     SET check_out_at = NULL, updated_at = now()
   WHERE check_out_at IS NOT NULL
     AND check_out_at <= check_in_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: cleared % attendance check-outs at or before check-in', n;

  FOREACH t IN ARRAY forced LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ── 4. Enforce the 0010 constraints (real existence check) ───────────────────────
DO $$
DECLARE
  c        record;
  existing record;
  want     text;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('meeting.meetings', 'chk_meetings_status', 'c',
       $d$CHECK (status IN ('draft', 'scheduled', 'agenda_locked', 'in_progress', 'adjourned',
         'minutes_pending', 'minutes_approved', 'closed', 'archived', 'cancelled'))$d$),
      ('meeting.meetings', 'chk_meetings_type', 'c',
       $d$CHECK (type IN ('committee', 'board', 'departmental', 'ad_hoc', 'statutory'))$d$),
      ('meeting.meetings', 'chk_meetings_confidentiality_level', 'c',
       $d$CHECK (confidentiality_level IN ('public', 'internal', 'confidential', 'secret', 'top_secret'))$d$),
      ('meeting.meetings', 'fk_meetings_committee_id', 'f',
       $d$FOREIGN KEY (committee_id) REFERENCES meeting.committees(id)$d$),
      ('meeting.meetings', 'fk_meetings_series_id', 'f',
       $d$FOREIGN KEY (series_id) REFERENCES meeting.meeting_series(id)$d$),
      ('meeting.participants', 'chk_participants_role', 'c',
       $d$CHECK (role IN ('chairperson', 'member', 'secretary', 'special_invitee', 'observer', 'presenter'))$d$),
      ('meeting.participants', 'chk_participants_invitation_status', 'c',
       $d$CHECK (invitation_status IN ('pending', 'accepted', 'tentative', 'declined'))$d$),
      ('meeting.participants', 'chk_participants_attendance_mode', 'c',
       $d$CHECK (attendance_mode IS NULL OR attendance_mode IN ('in_person', 'vc'))$d$),
      ('meeting.agenda_items', 'chk_agenda_items_status', 'c',
       $d$CHECK (status IN ('proposed', 'accepted', 'deferred', 'withdrawn', 'carried_forward'))$d$),
      ('meeting.agenda_items', 'chk_agenda_items_outcome_type', 'c',
       $d$CHECK (outcome_type IN ('decision', 'discussion', 'information', 'ratification', 'noting'))$d$),
      ('meeting.agenda_items', 'chk_agenda_items_category', 'c',
       $d$CHECK (category IS NULL OR category IN ('standing', 'arising_from_minutes', 'new_business'))$d$),
      ('meeting.agenda_items', 'chk_agenda_items_confidentiality_level', 'c',
       $d$CHECK (confidentiality_level IN ('public', 'internal', 'confidential', 'secret', 'top_secret'))$d$),
      ('meeting.agenda_items', 'fk_agenda_items_deferred_to', 'f',
       $d$FOREIGN KEY (deferred_to) REFERENCES meeting.agenda_items(id)$d$),
      ('meeting.attendance_records', 'chk_attendance_method', 'c',
       $d$CHECK (method IN ('qr', 'biometric', 'geo', 'vc', 'manual'))$d$),
      ('meeting.attendance_records', 'chk_attendance_mode', 'c',
       $d$CHECK (mode IN ('in_person', 'vc'))$d$),
      ('meeting.attendance_records', 'chk_attendance_status', 'c',
       $d$CHECK (status IN ('present', 'absent', 'joined_late', 'left_early', 'attending_via_vc'))$d$),
      ('meeting.attendance_records', 'chk_attendance_checkout_after_checkin', 'c',
       $d$CHECK (check_out_at IS NULL OR check_out_at > check_in_at)$d$)
    ) AS v(tbl, name, kind, def)
  LOOP
    -- Canonical, cast/paren-insensitive text of the wanted definition (pg_dump round trips
  -- re-deparse the same CHECK with casts in different places): add it under a scratch name (NOT VALID,
    -- catalog-only), read it back, drop it. Lets an existing constraint be compared by
    -- definition rather than trusted by name.
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID', c.tbl, 'f100_probe_' || c.name, c.def);
    SELECT regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') INTO want
      FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = 'f100_probe_' || c.name;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, 'f100_probe_' || c.name);

    SELECT oid, contype, regexp_replace(regexp_replace(regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', ''),
             '::(character varying|text|uuid|timestamp with time zone)(\[\])?', '', 'g'), '[()[:space:]]', '', 'g') AS def INTO existing
      FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name;

    IF existing.oid IS NULL THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
      RAISE NOTICE '0015: added % on %', c.name, c.tbl;
    ELSIF existing.contype <> c.kind OR existing.def <> want THEN
      RAISE EXCEPTION '0015: % on % exists with a different definition: % (wanted %)',
        c.name, c.tbl, existing.def, want;
    END IF;

    IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.name);
      RAISE NOTICE '0015: validated % on %', c.name, c.tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
