ALTER TABLE plugin.items
  ADD COLUMN IF NOT EXISTS publisher varchar(160),
  ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS signature_hash varchar(128),
  ADD COLUMN IF NOT EXISTS risk_level varchar(16) NOT NULL DEFAULT 'low';

CREATE TABLE IF NOT EXISTS plugin.installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'installed',
  installed_at timestamptz NOT NULL DEFAULT now(),
  enabled_at timestamptz,
  disabled_at timestamptz,
  installed_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_installs_tenant ON plugin.installs(tenant_id, status);
