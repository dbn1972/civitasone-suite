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
--   - attendance_records with check_out_at <= check_in_at: 43 at 12:31Z and still
--     growing, ALL on meetings titled 'Attendance-bounds fixture meeting', written by
--     tests/integration-attendance-bounds.test.ts runs that reached the UAT database.
--
-- This migration (repairs are scoped to exactly those test rows; anything else that
-- would block a constraint makes it FAIL LOUDLY instead of being changed):
--   0. Copies every value it is about to change into meeting.f100_repair_backup
--      (table, row id, column, old value), so nothing is lost.
--   1. Archives the FQ9-RUNNER test meeting (test_data_archived_at, the flag 0014 adds;
--      added here too IF NOT EXISTS so this file does not depend on 0014's merge order)
--      and clears its dangling committee_id. Any OTHER dangling committee_id, series_id or
--      deferred_to raises.
--   2. Sets check_out_at = NULL on check_out_at <= check_in_at rows of the
--      'Attendance-bounds fixture meeting' meetings only. Any OTHER such row raises.
--   3. Adds the 17 constraints of 0010 with a REAL existence check: the constraint must
--      exist ON THAT TABLE, with that name and type AND the same definition. A
--      same-named constraint with a different definition raises (never silently
--      skipped). Missing ones are added NOT VALID and then VALIDATEd; an existing NOT
--      VALID one is VALIDATEd.
--
-- Rows changed on UAT: meetings 1 (archived + committee nulled), attendance_records =
-- the fixture rows at deploy time (43 at 12:31Z). Fresh / CI databases: 0 rows, all
-- constraints already exist from 0010 and are validated; only the empty backup table is
-- created.
--
-- Idempotent: every UPDATE is predicate-scoped and matches nothing on a re-run, the
-- backup insert is ON CONFLICT DO NOTHING, every constraint step is guarded as above.
--
-- RLS: the per-service runner applies this as the table OWNER (meeting_svc, NOBYPASSRLS)
-- and these tables are FORCE RLS, so statements without a tenant would see no rows. FORCE
-- is lifted for the repair block and restored in the same transaction (house idiom, see
-- 0014). Constraint validation is not subject to RLS.
--
-- Preview on UAT (SELECT only):
--   SELECT a.id, a.check_in_at, a.check_out_at FROM meeting.attendance_records a
--     JOIN meeting.meetings m ON m.id = a.meeting_id
--    WHERE a.check_out_at <= a.check_in_at AND m.title = 'Attendance-bounds fixture meeting';
--
-- Rollback: see 0010's header (DROP CONSTRAINT IF EXISTS ...). Original values are in
-- meeting.f100_repair_backup:
--   UPDATE meeting.attendance_records a SET check_out_at = b.old_value::timestamptz
--     FROM meeting.f100_repair_backup b
--    WHERE b.table_name = 'attendance_records' AND b.column_name = 'check_out_at' AND b.row_id = a.id;
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE meeting.meetings ADD COLUMN IF NOT EXISTS test_data_archived_at TIMESTAMPTZ;

-- ── 0. Backup of every value this migration changes ──────────────────────────────
CREATE TABLE IF NOT EXISTS meeting.f100_repair_backup (
  tenant_id    UUID        NOT NULL,
  table_name   TEXT        NOT NULL,
  row_id       UUID        NOT NULL,
  column_name  TEXT        NOT NULL,
  old_value    TEXT,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, table_name, row_id, column_name)
);
ALTER TABLE meeting.f100_repair_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.f100_repair_backup FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS f100_repair_backup_tenant ON meeting.f100_repair_backup;
CREATE POLICY f100_repair_backup_tenant ON meeting.f100_repair_backup
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meeting_scanner') THEN
    GRANT SELECT ON meeting.f100_repair_backup TO meeting_scanner;
  END IF;
END $$;

-- ── 1-2. Repair the identified test rows; fail loudly on anything else ───────────
DO $$
DECLARE
  t     text;
  n     bigint;
  -- committees, meeting_series and the backup are also lifted: the orphan checks READ
  -- committees/series (under FORCE RLS the owner would see none of their rows and every
  -- reference would look dangling) and the backup is written cross-tenant.
  tbls  text[] := ARRAY['meeting.meetings', 'meeting.agenda_items', 'meeting.attendance_records',
                        'meeting.committees', 'meeting.meeting_series', 'meeting.f100_repair_backup'];
  forced text[] := '{}';
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', t);
      forced := forced || t;
    END IF;
  END LOOP;

  -- The FQ9-RUNNER test meeting: archive it and clear its dangling committee.
  INSERT INTO meeting.f100_repair_backup (tenant_id, table_name, row_id, column_name, old_value)
  SELECT m.tenant_id, 'meetings', m.id, 'committee_id', m.committee_id::text
    FROM meeting.meetings m
   WHERE m.id = 'baa2a61c-5794-3424-5339-7ddd1f8380f7' AND m.title LIKE 'FQ9-RUNNER-%'
     AND m.committee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.committees c WHERE c.id = m.committee_id)
  ON CONFLICT DO NOTHING;

  UPDATE meeting.meetings m
     SET test_data_archived_at = COALESCE(m.test_data_archived_at, now()),
         committee_id = NULL, updated_at = now()
   WHERE m.id = 'baa2a61c-5794-3424-5339-7ddd1f8380f7' AND m.title LIKE 'FQ9-RUNNER-%'
     AND m.committee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.committees c WHERE c.id = m.committee_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: archived the FQ9-RUNNER test meeting and cleared its dangling committee: % row(s)', n;

  -- Attendance-bounds fixture rows: back up, then clear the impossible check-out.
  INSERT INTO meeting.f100_repair_backup (tenant_id, table_name, row_id, column_name, old_value)
  SELECT a.tenant_id, 'attendance_records', a.id, 'check_out_at', a.check_out_at::text
    FROM meeting.attendance_records a
    JOIN meeting.meetings m ON m.id = a.meeting_id
   WHERE a.check_out_at IS NOT NULL AND a.check_out_at <= a.check_in_at
     AND m.title = 'Attendance-bounds fixture meeting'
  ON CONFLICT DO NOTHING;

  UPDATE meeting.attendance_records a
     SET check_out_at = NULL, updated_at = now()
    FROM meeting.meetings m
   WHERE m.id = a.meeting_id
     AND a.check_out_at IS NOT NULL AND a.check_out_at <= a.check_in_at
     AND m.title = 'Attendance-bounds fixture meeting';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0015: cleared % attendance-bounds fixture check-outs at or before check-in', n;

  -- Anything else that would block the constraints is NOT repaired: stop here.
  SELECT count(*) INTO n FROM meeting.meetings m
   WHERE m.committee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.committees c WHERE c.id = m.committee_id);
  IF n > 0 THEN
    RAISE EXCEPTION '0015: % meeting(s) reference a committee that does not exist; not repaired automatically', n;
  END IF;
  SELECT count(*) INTO n FROM meeting.meetings m
   WHERE m.series_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.meeting_series s WHERE s.id = m.series_id);
  IF n > 0 THEN
    RAISE EXCEPTION '0015: % meeting(s) reference a series that does not exist; not repaired automatically', n;
  END IF;
  SELECT count(*) INTO n FROM meeting.agenda_items a
   WHERE a.deferred_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting.agenda_items s WHERE s.id = a.deferred_to);
  IF n > 0 THEN
    RAISE EXCEPTION '0015: % agenda item(s) defer to an item that does not exist; not repaired automatically', n;
  END IF;
  SELECT count(*) INTO n FROM meeting.attendance_records
   WHERE check_out_at IS NOT NULL AND check_out_at <= check_in_at;
  IF n > 0 THEN
    RAISE EXCEPTION '0015: % attendance record(s) outside the test fixture have check_out_at <= check_in_at; not repaired automatically', n;
  END IF;

  FOREACH t IN ARRAY forced LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ── 3. Enforce the 0010 constraints (real existence check) ───────────────────────
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
