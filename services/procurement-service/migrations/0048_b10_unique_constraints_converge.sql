-- Migration 0048: converge the 0021-0024 UNIQUE constraints (UAT bundle 10, F100 drift).
--
-- 0021-0024 declared six UNIQUE constraints inline in CREATE TABLE IF NOT EXISTS.
-- On UAT the tables already existed (older definition), so the CREATE was a
-- silent no-op: rc=0, nothing created. UAT carries same-named standalone UNIQUE
-- INDEXES instead of constraints, so ON CONFLICT ON CONSTRAINT fails there and the
-- schema differs from every migration-built database (T9 schema-drift report).
--
-- For each constraint this checks the REAL definition (pg_get_constraintdef), not
-- just the name:
--   * constraint present with the expected definition -> nothing to do;
--   * constraint present with another definition      -> drop and recreate;
--   * a same-named unique btree index on exactly these columns (UAT) -> promote
--     it with ADD CONSTRAINT ... USING INDEX (no rebuild, uniqueness never lapses);
--   * a same-named index with any other definition    -> drop it, then add.
-- A duplicate key makes ADD CONSTRAINT fail, which aborts the whole block (one
-- statement = one transaction), so nothing is half-applied and the deploy fails
-- loudly instead of no-op'ing. UAT had 0 duplicates when measured (2026-10-31).
--
-- IDEMPOTENT: a second run finds every definition equal and changes nothing.
SET lock_timeout = '5s';

DO $$
DECLARE
  spec record;
  have text;
  idx  oid;
  old_path text := current_setting('search_path');
BEGIN
  -- pg_get_constraintdef/pg_get_indexdef qualify names relative to search_path;
  -- pin it so the comparison is environment-independent.
  PERFORM set_config('search_path', 'pg_catalog', true);

  FOR spec IN
    SELECT * FROM (VALUES
      ('planning', 'procurement_plans',          'uq_proc_plans_tenant_no',     'tenant_id, plan_no'),
      ('po',       'procurement_po_amendments',  'uq_po_amendment_no',          'po_id, amendment_no'),
      ('po',       'procurement_po_milestones',  'uq_po_milestone_no',          'po_id, milestone_no'),
      ('tender',   'procurement_prebid_queries', 'uq_prebid_query_no',          'tender_id, query_no'),
      ('tender',   'procurement_tender_corrigenda', 'uq_tender_corrigendum_no', 'tender_id, corrigendum_no'),
      ('vendor',   'procurement_vendor_scorecards', 'uq_vscorecard_vendor_period', 'tenant_id, vendor_id, period')
    ) AS v(sch, tbl, con, cols)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO have
      FROM pg_constraint c
     WHERE c.conrelid = format('%I.%I', spec.sch, spec.tbl)::regclass
       AND c.conname = spec.con;

    CONTINUE WHEN have = format('UNIQUE (%s)', spec.cols);

    IF have IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', spec.sch, spec.tbl, spec.con);
    ELSE
      SELECT i.indexrelid INTO idx
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = ic.relnamespace
       WHERE n.nspname = spec.sch AND ic.relname = spec.con;
      IF idx IS NOT NULL THEN
        IF pg_get_indexdef(idx) = format('CREATE UNIQUE INDEX %s ON %I.%I USING btree (%s)',
                                         spec.con, spec.sch, spec.tbl, spec.cols) THEN
          EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE USING INDEX %I',
                         spec.sch, spec.tbl, spec.con, spec.con);
          CONTINUE;
        END IF;
        EXECUTE format('DROP INDEX %I.%I', spec.sch, spec.con);
      END IF;
    END IF;

    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (%s)',
                   spec.sch, spec.tbl, spec.con, spec.cols);
  END LOOP;

  PERFORM set_config('search_path', old_path, true);
END
$$;
