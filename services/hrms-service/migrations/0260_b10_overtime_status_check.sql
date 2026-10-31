-- Migration 0260: restore the overtime-request status CHECK (UAT bundle 10, F100 drift).
--
-- NUMBERING: deliberately 0260, not the next free 0255. Another bundle-10 fixer
-- (F100 data-blocked migrations: hrms 0185/0135) is adding hrms migrations in
-- parallel; a clearly higher number cannot collide with theirs. Order does not
-- matter: this only depends on 0148.
--
-- 0148 declares status ... CHECK (status IN ('pending','approved','rejected'))
-- inline in CREATE TABLE IF NOT EXISTS. On UAT the table already existed, so the
-- CREATE was a silent no-op (rc=0) and the column has no CHECK at all. UAT rows
-- when measured (2026-10-31): pending 31, approved 50, rejected 26 -- all valid.
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
  sch  text := 'attendance';
  tbl  text := 'hrms_overtime_requests';
  con  text := 'hrms_overtime_requests_status_check';
  -- Added from the SAME source form the original migration uses, so the stored
  -- expression deparses exactly like the migration-built database's.
  ddl  text := $def$CHECK (status IN ('pending', 'approved', 'rejected'))$def$;
  -- pg_get_constraintdef() of the migration-built (CI bootstrap) database.
  want text := $def$CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))$def$;
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
      RAISE NOTICE '0260: %.% % differs (live: %); recreating', sch, tbl, con, have;
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
      RAISE WARNING '0260: %.% % deparses as % (expected %)', sch, tbl, con, have, want;
    END IF;
  END IF;

  PERFORM set_config('search_path', old_path, true);
END
$$;
