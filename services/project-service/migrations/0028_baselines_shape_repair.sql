-- 0028_baselines_shape_repair.sql
-- UAT DB sweep 2026-10-28 (g4): on the UAT database project.project_baselines still had the OLD
-- 0005 shape (baseline_no/snapshot_date/planned_*), so POST /v1/projects/:id/baselines was accepted
-- (202) but the consumer INSERT failed (column "label" does not exist), and GET /:id/baselines and
-- GET /:id/evm returned 500. Migration 0026 only acts when project.baselines (0017) exists, and 0017
-- (CREATE INDEX CONCURRENTLY inside a migration transaction) had not been applied there.
-- This repairs any database in that state: a legacy-shaped project_baselines is dropped when empty
-- or preserved as project_baselines_legacy_0005 when it holds rows (never lost), then the active
-- table (label/snapshot_data) is renamed from project.baselines or created, with RLS + index.
-- Idempotent: a no-op once project.project_baselines has the label column. No monetary data touched.
-- Rollback: none needed (additive); legacy rows, if any, remain in project_baselines_legacy_0005.
-- Affected services: project-service

SET lock_timeout = '5s';

DO $$
DECLARE
  legacy_rows bigint;
BEGIN
  IF to_regclass('project.project_baselines') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'project' AND table_name = 'project_baselines' AND column_name = 'label'
  ) THEN
    EXECUTE 'ALTER TABLE project.project_baselines NO FORCE ROW LEVEL SECURITY';
    EXECUTE 'SELECT count(*) FROM project.project_baselines' INTO legacy_rows;
    IF legacy_rows = 0 THEN
      EXECUTE 'DROP TABLE project.project_baselines';
    ELSE
      EXECUTE 'ALTER TABLE project.project_baselines RENAME TO project_baselines_legacy_0005';
      EXECUTE 'ALTER TABLE project.project_baselines_legacy_0005 FORCE ROW LEVEL SECURITY';
    END IF;
  END IF;

  IF to_regclass('project.project_baselines') IS NULL THEN
    IF to_regclass('project.baselines') IS NOT NULL THEN
      EXECUTE 'ALTER TABLE project.baselines RENAME TO project_baselines';
    ELSE
      EXECUTE $t$
        CREATE TABLE project.project_baselines (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id     UUID NOT NULL,
          project_id    UUID NOT NULL,
          label         VARCHAR(255) NOT NULL,
          snapshot_data JSONB NOT NULL,
          created_by    UUID NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          version       INT NOT NULL DEFAULT 1
        )
      $t$;
    END IF;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_baselines_project_tenant
  ON project.project_baselines (project_id, tenant_id, created_at DESC);

ALTER TABLE project.project_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_baselines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON project.project_baselines;
CREATE POLICY tenant_isolation ON project.project_baselines
  USING (tenant_id = project.current_tenant_id());

-- A table created/renamed here by a different role than the usual migration owner would not inherit
-- the service's default privileges; grant explicitly (guarded so non-prod role layouts still apply).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project.project_baselines TO project_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_scanner') THEN
    GRANT SELECT ON project.project_baselines TO project_scanner;
  END IF;
END
$$;
