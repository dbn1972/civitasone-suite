-- Migration: 0036_asset_locations_scan_workorder_guards.sql
-- fp-assets-01 finish batch. Additive + idempotent.
--   GAP-ASSETS-LOCATIONS-02: locations can be deactivated / reactivated (is_active).
--   GAP-ASSETS-LOCATIONS-03: assets reference a functional location by id (location_id);
--                            the free-text `location` column stays for display/back-compat.
--   GAP-ASSETS-SCAN-06:      barcode is unique per tenant, and every scan is logged
--                            (enterprise.asset_scan_log, evidence of physical verification).
--   GAP-ASSETS-MAINTENANCE-NEW-06: at most ONE open work order per (asset, maintenance type).
-- Rollback: DROP INDEX IF EXISTS maintenance.uq_work_orders_one_open_per_asset_type;
--           DROP INDEX IF EXISTS register.uq_asset_assets_tenant_barcode;
--           DROP TABLE IF EXISTS enterprise.asset_scan_log;
--           ALTER TABLE register.asset_assets DROP COLUMN IF EXISTS location_id;
--           ALTER TABLE enterprise.functional_locations DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS deactivated_at, DROP COLUMN IF EXISTS deactivated_by;

SET lock_timeout = '5s';

-- locations: deactivate
ALTER TABLE enterprise.functional_locations ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE enterprise.functional_locations ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE enterprise.functional_locations ADD COLUMN IF NOT EXISTS deactivated_by uuid;

-- asset -> location link
ALTER TABLE register.asset_assets ADD COLUMN IF NOT EXISTS location_id uuid;
CREATE INDEX IF NOT EXISTS idx_asset_assets_location_id
  ON register.asset_assets (tenant_id, location_id) WHERE location_id IS NOT NULL;

-- barcode unique per tenant. Legacy duplicates FAIL the migration loudly (listing them) instead of being
-- skipped: the service relies on this index as the race backstop, so it must never be silently absent.
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(format('(tenant %s, barcode %s) x%s', tenant_id, barcode, n), '; ') INTO dup FROM (
    SELECT tenant_id, barcode, count(*) AS n FROM register.asset_assets
    WHERE barcode IS NOT NULL GROUP BY tenant_id, barcode HAVING count(*) > 1 LIMIT 20) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'cannot create uq_asset_assets_tenant_barcode: duplicate barcodes exist: %', dup;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_assets_tenant_barcode
  ON register.asset_assets (tenant_id, barcode) WHERE barcode IS NOT NULL;

-- scan log
CREATE TABLE IF NOT EXISTS enterprise.asset_scan_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  barcode    text        NOT NULL,
  asset_id   uuid,
  found      boolean     NOT NULL,
  scanned_by uuid        NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_scan_log_tenant_time ON enterprise.asset_scan_log (tenant_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_scan_log_asset ON enterprise.asset_scan_log (tenant_id, asset_id) WHERE asset_id IS NOT NULL;

ALTER TABLE enterprise.asset_scan_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_scan_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.asset_scan_log;
CREATE POLICY tenant_isolation_policy ON enterprise.asset_scan_log
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- one open work order per asset + type (legacy duplicates fail the migration loudly, listing them)
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(format('(tenant %s, asset %s, type %s) x%s', tenant_id, asset_id, maintenance_type, n), '; ') INTO dup FROM (
    SELECT tenant_id, asset_id, maintenance_type, count(*) AS n FROM maintenance.asset_work_orders
    WHERE status = 'open' GROUP BY tenant_id, asset_id, maintenance_type HAVING count(*) > 1 LIMIT 20) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'cannot create uq_work_orders_one_open_per_asset_type: duplicate open work orders exist: %', dup;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_one_open_per_asset_type
  ON maintenance.asset_work_orders (tenant_id, asset_id, maintenance_type) WHERE status = 'open';
