CREATE TABLE IF NOT EXISTS theme.revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'draft',
  tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_theme_revisions_tenant ON theme.revisions(tenant_id, created_at DESC);
