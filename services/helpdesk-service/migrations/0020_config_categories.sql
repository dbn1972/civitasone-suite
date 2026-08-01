-- Purpose: Create categories table for hierarchical category master (CFG-02)
-- Rollback: DROP TABLE IF EXISTS helpdesk.categories;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(128) NOT NULL,
  parent_id   uuid REFERENCES helpdesk.categories(id),
  ordinal     integer NOT NULL DEFAULT 0,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_tenant_id
  ON helpdesk.categories (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_parent_id
  ON helpdesk.categories (parent_id);

-- RLS
ALTER TABLE helpdesk.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.categories FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'categories_tenant_isolation'
  ) THEN
    CREATE POLICY categories_tenant_isolation ON helpdesk.categories
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.categories TO helpdesk_svc;
