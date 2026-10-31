-- Migration 0038: align the counsel-brief status CHECK with the app (UAT bundle 10, F100 drift).
--
-- 0011 adds legal_counsel_briefs_status_check as ('assigned','accepted','completed',
-- 'withdrawn') -- the counsel state machine (validators.ts, commands.ts) -- inside
-- EXCEPTION WHEN duplicate_object THEN NULL. UAT already had an older same-named
-- CHECK ('assigned','in_progress','completed','cancelled'), so 0011 swallowed the
-- duplicate and the stale definition stayed: the app's 'accepted' and 'withdrawn'
-- transitions are rejected by the database. UAT rows when measured (2026-10-31):
-- 4, all 'assigned'. A row in a legacy-only state at deploy time makes the ADD
-- fail loudly rather than being silently re-mapped.
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
  sch  text := 'counsel';
  tbl  text := 'legal_counsel_briefs';
  con  text := 'legal_counsel_briefs_status_check';
  -- Added from the SAME source form the original migration uses, so the stored
  -- expression deparses exactly like the migration-built database's.
  ddl  text := $def$CHECK (status IN ('assigned', 'accepted', 'completed', 'withdrawn'))$def$;
  -- pg_get_constraintdef() of the migration-built (CI bootstrap) database.
  want text := $def$CHECK (((status)::text = ANY ((ARRAY['assigned'::character varying, 'accepted'::character varying, 'completed'::character varying, 'withdrawn'::character varying])::text[])))$def$;
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
      RAISE NOTICE '0038: %.% % differs (live: %); recreating', sch, tbl, con, have;
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
      RAISE WARNING '0038: %.% % deparses as % (expected %)', sch, tbl, con, have, want;
    END IF;
  END IF;

  PERFORM set_config('search_path', old_path, true);
END
$$;
