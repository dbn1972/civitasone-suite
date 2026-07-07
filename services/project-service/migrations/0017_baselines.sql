-- Purpose: Create baselines table for project schedule snapshots and EVM tracking
-- Rollback: DROP TABLE IF EXISTS project.baselines;
-- Affected services: project-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS project.baselines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  project_id    UUID NOT NULL,
  label         VARCHAR(255) NOT NULL,
  snapshot_data JSONB NOT NULL,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  version       INT NOT NULL DEFAULT 1
);

-- Index for listing baselines by project (newest first)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_baselines_project_tenant
  ON project.baselines (project_id, tenant_id, created_at DESC);

-- RLS enforcement
ALTER TABLE project.baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.baselines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON project.baselines;
CREATE POLICY tenant_isolation ON project.baselines
  USING (tenant_id = project.current_tenant_id());
