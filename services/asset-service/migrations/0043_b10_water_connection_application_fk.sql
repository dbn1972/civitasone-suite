-- Migration 0043: restore the water-connection -> application FK (UAT bundle 10, F100 drift).
--
-- 0027 declared application_id ... REFERENCES asset_water_applications(id) inline
-- in CREATE TABLE IF NOT EXISTS. On UAT the table already existed, so the CREATE
-- was a silent no-op (rc=0) and the FK was never created: a connection can point
-- at an application that does not exist. UAT had 0 orphan rows when measured
-- (2026-10-31); an orphan at deploy time makes the ADD fail loudly.
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
  sch  text := 'water_connections';
  tbl  text := 'asset_water_connections';
  con  text := 'asset_water_connections_application_id_fkey';
  -- Added from the SAME source form the original migration uses, so the stored
  -- expression deparses exactly like the migration-built database's.
  ddl  text := $def$FOREIGN KEY (application_id) REFERENCES water_connections.asset_water_applications(id)$def$;
  -- pg_get_constraintdef() of the migration-built (CI bootstrap) database.
  want text := $def$FOREIGN KEY (application_id) REFERENCES water_connections.asset_water_applications(id)$def$;
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
      RAISE NOTICE '0043: %.% % differs (live: %); recreating', sch, tbl, con, have;
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
      RAISE WARNING '0043: %.% % deparses as % (expected %)', sch, tbl, con, have, want;
    END IF;
  END IF;

  PERFORM set_config('search_path', old_path, true);
END
$$;
