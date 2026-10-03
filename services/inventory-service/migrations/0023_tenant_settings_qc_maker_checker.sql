-- 0023_tenant_settings_qc_maker_checker.sql
--
-- GAP-INVENTORY-GOODS-RETURNS-DETAIL-04: per-tenant inventory policy settings.
-- First setting: qc_maker_checker -- when true (the default), the user who
-- recorded a goods return may not record its QC verdict (maker != checker).
-- One row per tenant; a missing row means "all defaults" (maker-checker ON).
--
-- Idempotent. Rollback: DROP TABLE IF EXISTS inventory.tenant_settings;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS inventory.tenant_settings (
  tenant_id        UUID PRIMARY KEY,
  qc_maker_checker BOOLEAN     NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID        NOT NULL,
  version          INTEGER     NOT NULL DEFAULT 1
);

ALTER TABLE inventory.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.tenant_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON inventory.tenant_settings;
CREATE POLICY tenant_isolation ON inventory.tenant_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$ BEGIN
  GRANT ALL ON inventory.tenant_settings TO inventory_svc;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
