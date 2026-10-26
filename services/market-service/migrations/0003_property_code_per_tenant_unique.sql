-- Purpose: V4-C-01 -- market_properties.property_code was globally UNIQUE
-- (0001_initial.sql) although the value is tenant-supplied. A second tenant
-- reusing a code (e.g. "SHOP-001") hit a unique violation: cross-tenant
-- availability failure plus a code-existence oracle. Uniqueness is now
-- per tenant, matching the composite (tenant_id, code) convention used by
-- register.asset_assets.
-- Idempotent (migrations are re-applied in full; there is no ledger table).
-- Existing data cannot violate the new, weaker constraint.
-- Rollback (only valid while no two tenants share a code):
--   DROP INDEX IF EXISTS market.market_properties_tenant_code_uidx;
--   ALTER TABLE market.market_properties ADD CONSTRAINT market_properties_property_code_key UNIQUE (property_code);
-- Affected services: market-service

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS market_properties_tenant_code_uidx
  ON market.market_properties (tenant_id, property_code);

ALTER TABLE market.market_properties
  DROP CONSTRAINT IF EXISTS market_properties_property_code_key;
