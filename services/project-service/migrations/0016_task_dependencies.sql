-- Purpose: Create task_dependencies table for project scheduling (FS/SS/FF/SF dependencies with lag/lead)
-- Rollback: DROP TABLE IF EXISTS project.task_dependencies;
-- Affected services: project-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS project.task_dependencies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  project_id    UUID NOT NULL,
  from_task_id  UUID NOT NULL,
  to_task_id    UUID NOT NULL,
  dep_type      VARCHAR(2) NOT NULL DEFAULT 'FS'
                CHECK (dep_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_ms        BIGINT NOT NULL DEFAULT 0
                CHECK (lag_ms >= -31536000000 AND lag_ms <= 31536000000),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  version       INT NOT NULL DEFAULT 1
);

-- Indexes for common access patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_deps_project_tenant
  ON project.task_dependencies (project_id, tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_deps_from_task
  ON project.task_dependencies (from_task_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_deps_to_task
  ON project.task_dependencies (to_task_id);

-- Prevent duplicate dependency edges within a project
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_task_deps_unique_edge
  ON project.task_dependencies (project_id, from_task_id, to_task_id);

-- RLS enforcement
ALTER TABLE project.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.task_dependencies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON project.task_dependencies;
CREATE POLICY tenant_isolation ON project.task_dependencies
  USING (tenant_id = project.current_tenant_id());
