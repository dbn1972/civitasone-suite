-- Migration 0021: export-jobs status CHECK must allow its own default (UAT bundle 10, F100 drift).
--
-- 0010 sets export_jobs.status DEFAULT 'pending' and adds export_jobs_status_check
-- ('pending','processing','completed','failed') only IF NOT EXISTS by NAME. UAT
-- already had a same-named CHECK from 0002 ('queued','processing','completed',
-- 'failed'), so the guard skipped it: every insert relying on the column default
-- ('pending', which the export route returns) violates the live CHECK. UAT rows
-- when measured (2026-10-31): 7 completed, 4 failed -- all valid under the new set.
--
-- Checks the REAL definition (pg_get_constraintdef), not just the name: a
-- constraint with the expected definition is left alone; a same-named one with a
-- different definition is dropped and recreated; a missing one is added. The drop
-- and add are ONE DO block (one statement = one transaction), so the table is
-- never left without the constraint.
--
-- IDEMPOTENT: a second run finds the definition equal and changes nothing. The
-- comparison ignores only the varchar/text cast decoration that a pg_dump/restore
-- round trip rewrites, so a restored database is not churned on every deploy.
SET lock_timeout = '5s';

DO $$
DECLARE
  sch  text := 'analytics';
  tbl  text := 'export_jobs';
  con  text := 'export_jobs_status_check';
  -- Added from the SAME source form the original migration uses, so the stored
  -- expression deparses exactly like the migration-built database's.
  ddl  text := $def$CHECK (status IN ('pending', 'processing', 'completed', 'failed'))$def$;
  -- pg_get_constraintdef() of the migration-built (CI bootstrap) database.
  want text := $def$CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))$def$;
  have text;
  -- Cast decoration a dump/restore round trip changes without changing meaning:
  -- ANY ((ARRAY['a'::character varying])::text[]) vs ANY (ARRAY[('a'::character varying)::text]).
  norm_want text;
  old_path text := current_setting('search_path');
BEGIN
  -- pg_get_constraintdef qualifies names relative to search_path; pin it so the
  -- comparison is environment-independent.
  PERFORM set_config('search_path', 'pg_catalog', true);

  SELECT pg_get_constraintdef(c.oid) INTO have
    FROM pg_constraint c
   WHERE c.conrelid = format('%I.%I', sch, tbl)::regclass
     AND c.conname = con;

  norm_want := regexp_replace(regexp_replace(regexp_replace(want,
    $re$\('((?:[^']|'')*)'::character varying\)::text$re$, $re$'\1'$re$, 'g'),
    $re$'((?:[^']|'')*)'::character varying$re$, $re$'\1'$re$, 'g'),
    $re$\(\(ARRAY\[([^]]*)\]\)::text\[\]\)$re$, $re$(ARRAY[\1])$re$, 'g');

  IF have IS NULL OR regexp_replace(regexp_replace(regexp_replace(have,
       $re$\('((?:[^']|'')*)'::character varying\)::text$re$, $re$'\1'$re$, 'g'),
       $re$'((?:[^']|'')*)'::character varying$re$, $re$'\1'$re$, 'g'),
       $re$\(\(ARRAY\[([^]]*)\]\)::text\[\]\)$re$, $re$(ARRAY[\1])$re$, 'g') <> norm_want THEN
    IF have IS NOT NULL THEN
      RAISE NOTICE '0021: %.% % differs (live: %); recreating', sch, tbl, con, have;
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', sch, tbl, con);
    END IF;
    -- Validated in the same statement: a violating row aborts the whole block
    -- (the DROP above rolls back with it) and the deploy fails loudly.
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', sch, tbl, con, ddl);

    SELECT pg_get_constraintdef(c.oid) INTO have
      FROM pg_constraint c
     WHERE c.conrelid = format('%I.%I', sch, tbl)::regclass
       AND c.conname = con;
    IF have IS DISTINCT FROM want THEN
      -- Same constraint, different deparse (e.g. another PG major): still correct,
      -- but the next run would recreate it. Surface it instead of hiding it.
      RAISE WARNING '0021: %.% % deparses as % (expected %)', sch, tbl, con, have, want;
    END IF;
  END IF;

  PERFORM set_config('search_path', old_path, true);
END
$$;
