-- project-service migration 0007: world-class integrity hardening
-- Run as: project_svc on civitas_project
-- Additive + idempotent.
--   P0-1: composite (tenant_id, project_id) FKs + indexes on the bolted-on
--         world-class child tables so a child can never reference a project
--         that belongs to a different tenant (defence-in-depth behind the
--         app-level findProjectByIdTx check).
--   P1-5: project_resources gains created_by (every other world-class table
--         already records it).

-- A composite FK needs a matching unique key on the parent (tenant_id, id).
-- project_projects.id is already PK, so (tenant_id, id) is trivially unique;
-- add it explicitly so it can be FK-referenced.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_projects_tenant_id_id_key'
  ) THEN
    ALTER TABLE project.project_projects
      ADD CONSTRAINT project_projects_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

-- P1-5: created_by on project_resources (nullable for existing rows; app sets it).
ALTER TABLE project.project_resources
  ADD COLUMN IF NOT EXISTS created_by UUID;

-- Composite indexes + FKs on each world-class child table.
DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'project_risks','project_evm','project_ra_bills','project_time_extensions',
    'project_penalties','project_resources','project_baselines'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%1$s_tenant_project ON project.%1$s (tenant_id, project_id)', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = format('%s_tenant_project_fk', t)
    ) THEN
      EXECUTE format(
        'ALTER TABLE project.%1$s ADD CONSTRAINT %1$s_tenant_project_fk '
        || 'FOREIGN KEY (tenant_id, project_id) '
        || 'REFERENCES project.project_projects (tenant_id, id)', t);
    END IF;
  END LOOP;
END $$;
