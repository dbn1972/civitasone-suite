-- Purpose: TKT-11 — Saved Views for ticket list filtering/columns.
-- Creates helpdesk.saved_views table for per-user or shared filter presets.
-- Rollback: DROP TABLE IF EXISTS helpdesk.saved_views;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  owner_id    uuid NOT NULL,
  name        varchar(200) NOT NULL,
  filters     jsonb NOT NULL DEFAULT '{}',
  columns     jsonb NOT NULL DEFAULT '[]',
  is_default  boolean NOT NULL DEFAULT false,
  shared      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);

-- Fast lookup by tenant + owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saved_views_tenant_owner
  ON helpdesk.saved_views (tenant_id, owner_id);

-- Find shared views for a tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saved_views_tenant_shared
  ON helpdesk.saved_views (tenant_id) WHERE shared = true;

-- RLS
ALTER TABLE helpdesk.saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.saved_views FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'saved_views' AND schemaname = 'helpdesk' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON helpdesk.saved_views
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- Restricted grant
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.saved_views TO helpdesk_app;
  END IF;
END $$;
