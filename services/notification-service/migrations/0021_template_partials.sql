-- Purpose: Add partials table for reusable MJML components
-- Rollback: DROP TABLE IF EXISTS templates.partials;
-- Affected services: notification-service (template rendering, MJML partial resolution)
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS templates.partials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       varchar(128) NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partial_name_tenant
  ON templates.partials (tenant_id, name);

-- Enable RLS for tenant isolation
ALTER TABLE templates.partials ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS partials_tenant_isolation
  ON templates.partials
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
