-- 0027_tenant_ledger_source.sql
--
-- Per-tenant choice of which service owns the stock ledger the screens post to.
--   'stock'     (default) the legacy stock-service register: today's behaviour, unchanged.
--   'inventory' receipts, issues, transfers and adjustments post straight to this service
--               (inventory.movements / stock_balances / stock_ledger) using inventory items and stores.
-- A missing tenant_settings row means 'stock', so applying this migration changes nothing for any tenant.
--
-- Idempotent. Rollback: ALTER TABLE inventory.tenant_settings DROP COLUMN IF EXISTS ledger_source;

SET lock_timeout = '5s';

ALTER TABLE inventory.tenant_settings
  ADD COLUMN IF NOT EXISTS ledger_source TEXT NOT NULL DEFAULT 'stock';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_settings_ledger_source_chk'
      AND conrelid = 'inventory.tenant_settings'::regclass
  ) THEN
    ALTER TABLE inventory.tenant_settings
      ADD CONSTRAINT tenant_settings_ledger_source_chk CHECK (ledger_source IN ('stock', 'inventory'));
  END IF;
END $$;
