-- Purpose: Add locale variants for multi-language templates
-- Rollback: DROP SCHEMA i18n CASCADE;
-- Affected services: notification-service (i18n module, delivery pipeline locale resolution)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS i18n;

CREATE TABLE IF NOT EXISTS i18n.locale_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  template_id  uuid NOT NULL,
  locale       varchar(10) NOT NULL,
  subject      varchar(256),
  body         text NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_locale_status CHECK (status IN ('active', 'needs_review'))
);

-- One locale variant per template per locale
CREATE UNIQUE INDEX IF NOT EXISTS idx_locale_variant_unique
  ON i18n.locale_variants (template_id, locale);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locale_tenant
  ON i18n.locale_variants (tenant_id, template_id);

-- Enable RLS for tenant isolation
ALTER TABLE i18n.locale_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS i18n_tenant_isolation
  ON i18n.locale_variants
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
