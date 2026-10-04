-- 0076_pt_slab_versions.sql
--
-- GAP-PAYROLL-STATUTORY-PT-04 (remainder): effective-dated professional-tax
-- slab VERSIONS, so slabs follow each state's PT Act and Rules instead of
-- being overwritten in place.
--
--  * A slab set is a VERSION = (tenant, state, effective_from): the rows of
--    payroll.payroll_professional_tax that share that triple. A version stays
--    in force until the next version of the same state starts. The run engine
--    picks the version in force on the run's period end.
--  * payroll.payroll_pt_slab_versions: one header row per version (reason,
--    who/when, whether it was back-dated, source). FORCE RLS.
--  * payroll_professional_tax.february_amount_minor: optional amount for the
--    month of February (the last month of the financial year), for the states
--    whose Act levies a different amount then (e.g. the Maharashtra Tax on
--    Professions, Trades, Callings and Employments Act, 1975, Schedule I).
--    NULL = same amount every month. NOTHING is seeded here.
--  * The unique key moves from (tenant, state, slab_from) to
--    (tenant, state, effective_from, slab_from) so versions can coexist.
--
-- Seeded norms: the only slabs any migration seeds are Karnataka's two rows for
-- the dev tenant 00000000-0000-0000-0000-000000000001 (0005_world_class_payroll.sql;
-- Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976 --
-- VERIFY the seeded threshold / amount against the Schedule in force). They
-- become that tenant's baseline version below. No other state's figures are
-- seeded or invented here: each tenant enters its state's slabs, from that
-- state's PT Act and Rules, as a version.
--
-- Backfill: slabs that existed before versioning were applied by the engine
-- regardless of effective_from (the column was recorded but ignored). To keep
-- every existing run byte-identical, ALL pre-existing slabs of a (tenant,
-- state) become ONE version whose effective_from is 1900-01-01 ("since
-- always"); the date they previously carried is preserved in the header
-- reason. A later version (created through the API) takes over from its own
-- effective_from. Idempotent: only (tenant, state) pairs that have no header
-- row yet are touched, so a re-run changes nothing.
--
-- RLS: the backfill reads and updates every tenant, so the table owner is
-- exempt from FORCE only for the duration of the single DO block below, and
-- FORCE is re-asserted at its end (same transaction).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payroll.payroll_pt_slab_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  state_code     VARCHAR(4) NOT NULL,
  effective_from DATE NOT NULL,
  reason         TEXT,
  source         VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'migration')),
  back_dated     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID,
  approved_by    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_pt_slab_versions_tenant_state_eff UNIQUE (tenant_id, state_code, effective_from)
);

-- Upgrade path: a database that applied the first revision of this file has the
-- header table without approved_by (CREATE TABLE IF NOT EXISTS would skip it).
ALTER TABLE payroll.payroll_pt_slab_versions ADD COLUMN IF NOT EXISTS approved_by UUID;

ALTER TABLE payroll.payroll_pt_slab_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_pt_slab_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_pt_slab_versions;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_pt_slab_versions
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

ALTER TABLE payroll.payroll_professional_tax ADD COLUMN IF NOT EXISTS february_amount_minor BIGINT;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_professional_tax ADD CONSTRAINT payroll_pt_february_amount_chk
    CHECK (february_amount_minor IS NULL OR february_amount_minor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- New unique key first (no window without uniqueness), then drop the old one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pt_tenant_state_eff_slab
  ON payroll.payroll_professional_tax (tenant_id, state_code, effective_from, slab_from_minor);
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'payroll' AND rel.relname = 'payroll_professional_tax' AND con.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = k)
           = ARRAY['slab_from_minor', 'state_code', 'tenant_id']
  LOOP
    EXECUTE format('ALTER TABLE payroll.payroll_professional_tax DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Backfill (see header). Owner-exempt from FORCE only inside this block.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE payroll.payroll_professional_tax NO FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE payroll.payroll_pt_slab_versions NO FORCE ROW LEVEL SECURITY';

  DROP TABLE IF EXISTS _pt_unversioned;
  CREATE TEMP TABLE _pt_unversioned ON COMMIT DROP AS
    SELECT pt.tenant_id, pt.state_code,
           string_agg(DISTINCT pt.effective_from::text, ',' ORDER BY pt.effective_from::text) AS recorded
      FROM payroll.payroll_professional_tax pt
     WHERE NOT EXISTS (SELECT 1 FROM payroll.payroll_pt_slab_versions v
                        WHERE v.tenant_id = pt.tenant_id AND v.state_code = pt.state_code)
     GROUP BY pt.tenant_id, pt.state_code;

  UPDATE payroll.payroll_professional_tax pt
     SET effective_from = DATE '1900-01-01'
    FROM _pt_unversioned u
   WHERE pt.tenant_id = u.tenant_id AND pt.state_code = u.state_code
     AND pt.effective_from <> DATE '1900-01-01';

  INSERT INTO payroll.payroll_pt_slab_versions (tenant_id, state_code, effective_from, reason, source)
  SELECT u.tenant_id, u.state_code, DATE '1900-01-01',
         'Migrated from unversioned slabs (recorded effective_from: ' || u.recorded || '); applied to every period, as before.',
         'migration'
    FROM _pt_unversioned u
  ON CONFLICT (tenant_id, state_code, effective_from) DO NOTHING;

  EXECUTE 'ALTER TABLE payroll.payroll_professional_tax FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE payroll.payroll_pt_slab_versions FORCE ROW LEVEL SECURITY';
END $$;
