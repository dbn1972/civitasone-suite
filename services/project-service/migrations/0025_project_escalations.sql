-- GAP-PROJECTS-ESCALATIONS-02: a real, actionable escalation record.
--
-- Before this migration the /v1/projects/escalations endpoint was a SYNTHETIC
-- projection of projects in a delayed/on_hold/blocked status — there was no
-- escalation entity, so an escalation could not be acknowledged, reassigned or
-- cleared, and those actions could not be enforced or audited server-side.
-- This table persists the ACTION STATE for an escalation (keyed by the project
-- it concerns). The list endpoint overlays this persisted state onto the
-- synthetic projection: a project with no row here reads as a fresh "open"
-- escalation; once acted on, the persisted status/assignee/notes win.
--
-- Lifecycle (status CHECK): open → acknowledged → cleared, with reassign a
-- side transition that only changes escalated_to (and keeps the status). A
-- cleared escalation is terminal.
--
-- Additive and idempotent. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS project.project_escalations;
-- Affected services: project-service (escalation module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS project.project_escalations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  project_id     uuid NOT NULL,
  -- Snapshot of the issue/severity at the time of the first action, so the
  -- persisted record is self-describing even if the project's status later
  -- changes. severity mirrors the projection vocabulary (blocked/overdue/pending).
  severity       varchar(16) NOT NULL DEFAULT 'pending',
  issue          text,
  escalated_to   varchar(200),
  status         varchar(16) NOT NULL DEFAULT 'open',
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  cleared_by     uuid,
  cleared_at     timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT project_escalations_status_chk
    CHECK (status IN ('open', 'acknowledged', 'cleared'))
);

-- One actionable escalation record per (tenant, project): the projection is
-- project-centric, so the overlay keys on project_id. A second escalation for
-- the same project reuses the same row (its lifecycle moves forward).
CREATE UNIQUE INDEX IF NOT EXISTS project_escalations_tenant_project_uq
  ON project.project_escalations (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS project_escalations_tenant_status_idx
  ON project.project_escalations (tenant_id, status);

-- RLS: fail-closed tenant isolation mirroring the service's other tables
-- (USING + WITH CHECK against project.current_tenant_id()).
ALTER TABLE project.project_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_escalations;
CREATE POLICY tenant_isolation_policy ON project.project_escalations
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());

-- Read-only cross-tenant scanner (migration 0019) gets SELECT on new project
-- schema tables via ALTER DEFAULT PRIVILEGES, but that only applies to tables
-- created by project_svc. This migration may run as the superuser, so grant
-- explicitly to be safe (idempotent).
GRANT SELECT ON project.project_escalations TO project_scanner;

-- When this migration is applied by a superuser rather than the service role,
-- the table is owned by that superuser and project_svc has no privileges — the
-- running service (which connects as project_svc) could then neither read nor
-- write it. Transfer ownership to project_svc and grant the standard CRUD set
-- so the table behaves identically to one created by the service role itself.
-- Idempotent and a no-op when project_svc already owns it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_svc') THEN
    EXECUTE 'ALTER TABLE project.project_escalations OWNER TO project_svc';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON project.project_escalations TO project_svc';
  END IF;
END
$$;

