-- 0063_admin_edition_full_profile_set.sql
-- Tenant-profile slice B1: widen the admin directory edition CHECKs from (govt_dept, psu, small_office) to the full
-- catalogue set (@civitasone/tenant-profile ADMIN_EDITIONS), so a section8 tenant (and private / ngo / cooperative)
-- can be registered. Purely additive: every existing value stays valid. Idempotent: the existing edition CHECK on
-- each table is looked up by definition (its name was auto-generated in 0001) and replaced by a named constraint.
DO $body$
DECLARE
  t record;
  c record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('tenants', 'admin_tenants', 'admin_tenants_edition_check'),
    ('config',  'admin_editions', 'admin_editions_edition_check')
  ) AS v(sch, tbl, cname) LOOP
    FOR c IN
      SELECT con.conname FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE n.nspname = t.sch AND rel.relname = t.tbl AND con.contype = 'c'
         AND pg_get_constraintdef(con.oid) ILIKE '%edition%'
    LOOP
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', t.sch, t.tbl, c.conname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (edition IN (''govt_dept'',''psu'',''small_office'',''private'',''ngo'',''section8'',''cooperative''))',
      t.sch, t.tbl, t.cname);
  END LOOP;
END
$body$;
