-- 0006: P0-3 dual-book unique-key widening (additive, idempotent).
-- The original UNIQUE(tenant,asset) on schedules and UNIQUE(tenant,asset,period)
-- on entries reject the statutory (WDV) book insert that shares the same asset.
-- Widen both to include dep_book so company + statutory books coexist per asset.

-- Schedules: drop the narrow (tenant,asset) unique, add (tenant,asset,dep_book).
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'depreciation'
      AND rel.relname = 'asset_dep_schedules'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname::text)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['asset_id','tenant_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE depreciation.asset_dep_schedules DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dep_schedules_tenant_asset_book
  ON depreciation.asset_dep_schedules (tenant_id, asset_id, dep_book);

-- Entries: drop the narrow (tenant,asset,period) unique, add (tenant,asset,period,dep_book).
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'depreciation'
      AND rel.relname = 'asset_dep_entries'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname::text)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['asset_id','period','tenant_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE depreciation.asset_dep_entries DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dep_entries_tenant_asset_period_book
  ON depreciation.asset_dep_entries (tenant_id, asset_id, period, dep_book);
