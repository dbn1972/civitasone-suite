-- revenue-service: tenant-configurable default demand-notice period
-- Purpose: Owner decision F1 (2026-10-27). The notice period before a recovery
--          referral is allowed defaults to 15 days per tenant. An officer serving
--          a notice may only LENGTHEN it (never go below the tenant default);
--          this is enforced in the serve consumer. arrears.notice_settings holds
--          one row per tenant; a tenant with no row yet is treated as 15 and the
--          row is seeded (15) the first time a notice is served.
-- Rollback: DROP TABLE arrears.notice_settings;
-- Affected services: revenue-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS arrears.notice_settings (
  tenant_id                   uuid PRIMARY KEY,
  default_notice_period_days  integer NOT NULL DEFAULT 15 CHECK (default_notice_period_days BETWEEN 1 AND 365),
  updated_by                  uuid,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  version                     integer NOT NULL DEFAULT 1
);

ALTER TABLE arrears.notice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrears.notice_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON arrears.notice_settings;
CREATE POLICY tenant_isolation ON arrears.notice_settings
  USING      (tenant_id = rates.current_tenant_id())
  WITH CHECK (tenant_id = rates.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON arrears.notice_settings TO revenue_svc;
