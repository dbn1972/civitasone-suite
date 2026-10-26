-- Purpose: COMP-020. GET /v1/admin/editions, /entitlements and /gateways are
--   platform-operator (super_admin/platform_admin) cross-tenant READS. Like 0011,
--   add an additional permissive SELECT-only policy gated by the transaction-local
--   GUC app.platform_bypass, set only by scopedPlatformRead() AFTER
--   requireSuperAdmin() has authorised the request. INSERT/UPDATE/DELETE stay
--   governed solely by the strict tenant policy, so writes cannot skip tenant scoping.
--   The routes select only counts / non-secret columns (never secret_ciphertext).
-- Rollback: DROP POLICY platform_bypass_read_policy ON composition.tenant_entitlement;
--   DROP POLICY platform_bypass_read_policy ON composition.tenant_profile;
--   DROP POLICY platform_bypass_read_policy ON integration_settings.integration_settings;
-- Affected services: admin-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON composition.tenant_entitlement;
CREATE POLICY platform_bypass_read_policy ON composition.tenant_entitlement
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON integration_settings.integration_settings;
CREATE POLICY platform_bypass_read_policy ON integration_settings.integration_settings
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON composition.tenant_profile;
CREATE POLICY platform_bypass_read_policy ON composition.tenant_profile
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
