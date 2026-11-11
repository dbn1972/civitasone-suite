-- 0029_employee_members_staff_cost.sql
--
-- S8 G7 (project-linked staff and costing, MIS layer v1). Design:
-- ~/orch-logs/segments/section8-design.md section 8.
--
-- 1. project_members can reference an HRMS employee (employee_id) with or
--    without a login: user_id becomes nullable, and a CHECK keeps "at least one
--    of user_id / employee_id". Every existing row has a user_id, so existing
--    tenants and the userId API are unchanged. One row per (project, employee).
-- 2. project_projects.cost_center_id: the finance cost centre a project's staff
--    cost is charged to (nullable; set per project).
-- 3. project_staff_cost_postings: project cost TOTALS received from payroll
--    (payroll.project_cost.posted). Aggregates only -- no employee id and no
--    per-person amount can be stored here, which is how a project manager is
--    kept away from individual pay: the data never reaches this service.
--
-- Additive and idempotent. No existing data is rewritten.
--
-- Rollback:
--   DROP TABLE IF EXISTS project.project_staff_cost_postings;
--   DROP INDEX IF EXISTS project.ux_project_members_employee;
--   ALTER TABLE project.project_members DROP CONSTRAINT IF EXISTS project_members_identity_chk;
--   DELETE FROM project.project_members WHERE user_id IS NULL;
--   ALTER TABLE project.project_members ALTER COLUMN user_id SET NOT NULL, DROP COLUMN IF EXISTS employee_id;
--   ALTER TABLE project.project_projects DROP COLUMN IF EXISTS cost_center_id;
-- Affected services: project-service

SET lock_timeout = '5s';

ALTER TABLE project.project_projects ADD COLUMN IF NOT EXISTS cost_center_id uuid;

ALTER TABLE project.project_members ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE project.project_members ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_members_identity_chk') THEN
    ALTER TABLE project.project_members
      ADD CONSTRAINT project_members_identity_chk CHECK (user_id IS NOT NULL OR employee_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_project_members_employee
  ON project.project_members (project_id, employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project.project_staff_cost_postings (
  tenant_id            uuid NOT NULL,
  project_id           uuid NOT NULL,
  cost_month           char(7) NOT NULL,
  kind                 varchar(8) NOT NULL,
  source_id            uuid NOT NULL,
  gross_minor          bigint NOT NULL,
  employer_cost_minor  bigint NOT NULL,
  total_cost_minor     bigint NOT NULL,
  headcount            integer NOT NULL DEFAULT 0,
  received_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, cost_month, kind, source_id),
  CONSTRAINT psc_kind_chk CHECK (kind IN ('run', 'reclass')),
  CONSTRAINT psc_total_chk CHECK (total_cost_minor = gross_minor + employer_cost_minor)
);
CREATE INDEX IF NOT EXISTS ix_psc_project_month ON project.project_staff_cost_postings (tenant_id, project_id, cost_month);

ALTER TABLE project.project_staff_cost_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_staff_cost_postings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_staff_cost_postings;
CREATE POLICY tenant_isolation_policy ON project.project_staff_cost_postings
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());
