-- Purpose: Close a duplicate-reference-number bug found during deep-verification
-- on encroachment/domain.ts and illegal-construction/domain.ts (both created by
-- 0026_encroachment_schema.sql / 0027_illegal_construction_schema.sql): the four
-- human-facing reference-number generators —
--   generateComplaintNumber()  -> encroachment.encroachment_complaints.complaint_number
--   generateNoticeNumber()     -> encroachment.encroachment_notices.notice_number
--   generateCaseNumber()       -> illegal_construction.illegal_construction_cases.case_number
--   generateActionNumber()     -> illegal_construction.illegal_construction_actions.action_number
-- were plain in-process module-level counters (`let complaintSeq = 0`, etc.),
-- restarting at 0 on every process start and independent per replica in any
-- multi-replica deployment. None of the four columns had a UNIQUE constraint,
-- so two different records could silently receive the identical human-facing
-- reference number with nothing at the DB layer to reject it.
--
-- Fix (this migration is half of it — see the paired application-code change
-- replacing the in-memory counters with nextval() on the sequences below):
--   1. UNIQUE constraint on each of the four columns, added via this repo's
--      idempotent pg_constraint-existence-check pattern (see e.g.
--      contract-service/migrations/0013_templates_schema.sql), so any
--      remaining collision surfaces as a hard DB error instead of silently
--      duplicating.
--   2. One Postgres SEQUENCE per number type, replacing the in-memory
--      counters. Deliberately GLOBAL, not per-tenant: the counters they
--      replace took no tenant argument at all (every call site in both
--      consumer.ts files invokes e.g. `generateComplaintNumber()` with zero
--      arguments), i.e. they were already effectively global across every
--      tenant sharing one process. A single global sequence preserves that
--      exact scoping. This also matches the one other place in this repo
--      that already does this correctly: crm.grievance_ref_seq
--      (crm-service/migrations/0082_cpgrams_alignment.sql) is likewise one
--      global sequence, not per-tenant. Neither the existing reference-number
--      format nor any BRD note found in this service names a per-tenant
--      numbering requirement — flagging here in case that is in fact desired
--      product behavior, so it can be corrected deliberately rather than by
--      accident.
--
-- Pre-merge verification: queried the shared dev DB directly for existing
-- duplicate values in all four columns before writing this migration.
-- Zero duplicates found (row counts at check time: 1 complaint, 0 notices,
-- 1 case, 1 action), so the UNIQUE constraints below are safe to add as-is,
-- with no data reconciliation required.
--
-- Grants: schema ownership stays with civitas_admin (same posture as
-- 0026/0027 — "migrations are admin-run and the service role cannot alter
-- its own tables"), so each new sequence is owned by civitas_admin and
-- inspection_svc has no privilege on it by default. Mirrors 0026/0027's own
-- explicit table-grant block, applied here to the two new sequences.
-- (scripts/dev/grant-all.mjs would also cover this incidentally, via its
-- broad post-migrate "GRANT ALL ON ALL SEQUENCES IN SCHEMA" sweep — but that
-- script is dev-only convenience tooling, not a production grant path, so
-- the explicit grant below is the one that has to be correct on its own.)
--
-- Rollback:
--   ALTER TABLE encroachment.encroachment_complaints DROP CONSTRAINT IF EXISTS encroachment_complaints_complaint_number_key;
--   ALTER TABLE encroachment.encroachment_notices DROP CONSTRAINT IF EXISTS encroachment_notices_notice_number_key;
--   ALTER TABLE illegal_construction.illegal_construction_cases DROP CONSTRAINT IF EXISTS illegal_construction_cases_case_number_key;
--   ALTER TABLE illegal_construction.illegal_construction_actions DROP CONSTRAINT IF EXISTS illegal_construction_actions_action_number_key;
--   DROP SEQUENCE IF EXISTS encroachment.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS encroachment.notice_number_seq;
--   DROP SEQUENCE IF EXISTS illegal_construction.case_number_seq;
--   DROP SEQUENCE IF EXISTS illegal_construction.action_number_seq;
-- Affected services: inspection-service

SET lock_timeout = '5s';

-- 1. UNIQUE constraints (idempotent add pattern used elsewhere in this repo,
--    e.g. contract-service/migrations/0013_templates_schema.sql)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'encroachment_complaints_complaint_number_key'
                    AND conrelid = 'encroachment.encroachment_complaints'::regclass) THEN
    ALTER TABLE encroachment.encroachment_complaints
      ADD CONSTRAINT encroachment_complaints_complaint_number_key UNIQUE (complaint_number);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'encroachment_notices_notice_number_key'
                    AND conrelid = 'encroachment.encroachment_notices'::regclass) THEN
    ALTER TABLE encroachment.encroachment_notices
      ADD CONSTRAINT encroachment_notices_notice_number_key UNIQUE (notice_number);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'illegal_construction_cases_case_number_key'
                    AND conrelid = 'illegal_construction.illegal_construction_cases'::regclass) THEN
    ALTER TABLE illegal_construction.illegal_construction_cases
      ADD CONSTRAINT illegal_construction_cases_case_number_key UNIQUE (case_number);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'illegal_construction_actions_action_number_key'
                    AND conrelid = 'illegal_construction.illegal_construction_actions'::regclass) THEN
    ALTER TABLE illegal_construction.illegal_construction_actions
      ADD CONSTRAINT illegal_construction_actions_action_number_key UNIQUE (action_number);
  END IF;
END $$;

-- 2. Sequences replacing the in-process counters, seeded from the highest
--    existing trailing number so a table that already has rows (this one
--    does -- 1 complaint, 1 case, 1 action per the header note above) can't
--    hand out a number that collides with one already in use. The old
--    in-process counter also started at 1 each restart, so a fresh
--    `START 1` sequence would reproduce that exact already-used number on
--    its very first nextval() -- caught immediately by the UNIQUE
--    constraint above, but as a hard failure on the first insert after this
--    migration ships, not a corrected sequence.
--    setval(seq, N, false) makes the NEXT nextval() return exactly N (no
--    increment-past-N the way is_called=true would). GREATEST(1, max+1)
--    keeps N >= 1 always -- a bare `COALESCE(max,0)+1` would try to seed 0
--    for an empty table's max+1... no, +1 makes that 1 already; the
--    GREATEST is defensive in case a future format ever allows a 0 value --
--    and matters because plain setval(seq,0,...) errors with "value 0 is
--    out of bounds" (default sequences have MINVALUE 1). An empty table
--    (max IS NULL) seeds N=1, identical to the original `START 1` behavior.
--    Matches trailing digits via regex rather than a fixed substring, since
--    the value is a zero-padded seq (not a fixed-width record) that
--    formatComplaintNumber/etc. never truncate past 6 digits.
CREATE SEQUENCE IF NOT EXISTS encroachment.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS encroachment.notice_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS illegal_construction.case_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS illegal_construction.action_number_seq START 1;

SELECT setval('encroachment.complaint_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
              FROM encroachment.encroachment_complaints), 0) + 1), false);
SELECT setval('encroachment.notice_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(notice_number, '(\d+)$'))[1]::bigint)
              FROM encroachment.encroachment_notices), 0) + 1), false);
SELECT setval('illegal_construction.case_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(case_number, '(\d+)$'))[1]::bigint)
              FROM illegal_construction.illegal_construction_cases), 0) + 1), false);
SELECT setval('illegal_construction.action_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(action_number, '(\d+)$'))[1]::bigint)
              FROM illegal_construction.illegal_construction_actions), 0) + 1), false);

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Mirrors 0026/0027's grants block for the two new sequences: inspection_svc
-- needs USAGE granted explicitly to call nextval() on a civitas_admin-owned
-- sequence. SELECT/UPDATE are deliberately withheld — nextval() is the only
-- operation the application performs, and that requires USAGE alone.
GRANT USAGE ON SEQUENCE encroachment.complaint_number_seq TO inspection_svc;
GRANT USAGE ON SEQUENCE encroachment.notice_number_seq TO inspection_svc;
GRANT USAGE ON SEQUENCE illegal_construction.case_number_seq TO inspection_svc;
GRANT USAGE ON SEQUENCE illegal_construction.action_number_seq TO inspection_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA encroachment
  GRANT USAGE ON SEQUENCES TO inspection_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA illegal_construction
  GRANT USAGE ON SEQUENCES TO inspection_svc;
