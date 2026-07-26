-- 0031_case_task_mgmt.sql — generic Case, Transaction & Task Management capabilities.
-- CAP-031 (registry hardening), CAP-033 (links/split/merge), CAP-035 (workbaskets),
-- CAP-036 (checklists), CAP-037 (timeline — read-only, no table), CAP-038 (comments),
-- CAP-039 (deviation/waiver lifecycle), CAP-040 (closure/reopen/archival).
-- Additive + idempotent. RLS FORCED + fail-closed (tenant_id = workflow.current_tenant_id()).
-- workflow_svc is NOBYPASSRLS; migration runs as civitas_admin (table owner) so
-- FORCE RLS is required for the policy to apply to the owner too, and the service
-- role needs explicit DML grants.
-- Rollback: DROP the tables below; DISABLE ROW LEVEL SECURITY on cases/case_deviations.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION workflow.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- CAP-031 — harden the existing cross-domain case registry (0030 shipped the
-- tables with NO row-level security). Enable + FORCE fail-closed RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.cases;
CREATE POLICY tenant_isolation_policy ON workflow.cases
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());
-- de-duplicate registrations from the same source event (idempotent registry).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cases_source
  ON workflow.cases (tenant_id, source_service, source_ref_id);

ALTER TABLE workflow.case_deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.case_deviations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.case_deviations;
CREATE POLICY tenant_isolation_policy ON workflow.case_deviations
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- CAP-033 — generic case-link model (parent-child / related / duplicate-of /
-- split-from / merged-from). Cycle prevention is enforced in the domain layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.case_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  from_case_id uuid NOT NULL,
  to_case_id   uuid NOT NULL,
  link_type    varchar(24) NOT NULL,
  allocation   numeric(6,3),
  reason       varchar(500),
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  CONSTRAINT case_links_no_self CHECK (from_case_id <> to_case_id),
  CONSTRAINT case_links_type_ck CHECK (link_type IN ('parent_child','related','duplicate_of','split_from','merged_from'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_links
  ON workflow.case_links (tenant_id, from_case_id, to_case_id, link_type);
CREATE INDEX IF NOT EXISTS idx_case_links_from ON workflow.case_links (tenant_id, from_case_id);
CREATE INDEX IF NOT EXISTS idx_case_links_to   ON workflow.case_links (tenant_id, to_case_id);
ALTER TABLE workflow.case_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.case_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.case_links;
CREATE POLICY tenant_isolation_policy ON workflow.case_links
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- CAP-039 — deviation / waiver lifecycle with maker-checker approval.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.deviation_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  entity_type    varchar(48) NOT NULL,
  entity_id      uuid NOT NULL,
  deviation_type varchar(48) NOT NULL,
  reason         text NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'pending',
  requested_by   uuid NOT NULL,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  review_note    varchar(1000),
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deviation_status_ck CHECK (status IN ('pending','approved','rejected','expired','revoked'))
);
CREATE INDEX IF NOT EXISTS idx_deviation_entity ON workflow.deviation_requests (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_deviation_active ON workflow.deviation_requests (tenant_id, status) WHERE status = 'approved';
ALTER TABLE workflow.deviation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.deviation_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.deviation_requests;
CREATE POLICY tenant_isolation_policy ON workflow.deviation_requests
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- CAP-038 — threaded comments / notes on any (entity_type, entity_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.entity_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  entity_type       varchar(48) NOT NULL,
  entity_id         uuid NOT NULL,
  parent_comment_id uuid,
  body              text NOT NULL,
  visibility        varchar(12) NOT NULL DEFAULT 'internal',
  author_id         uuid NOT NULL,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_visibility_ck CHECK (visibility IN ('internal','external'))
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON workflow.entity_comments (tenant_id, entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON workflow.entity_comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;
ALTER TABLE workflow.entity_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.entity_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.entity_comments;
CREATE POLICY tenant_isolation_policy ON workflow.entity_comments
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- CAP-035 — named, configurable workbaskets (saved queues over tasks).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.workbaskets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        varchar(64) NOT NULL,
  name        varchar(200) NOT NULL,
  description varchar(500),
  filter      jsonb NOT NULL DEFAULT '{}',
  sort_order  varchar(64) NOT NULL DEFAULT 'created_at',
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workbaskets_code ON workflow.workbaskets (tenant_id, code);
ALTER TABLE workflow.workbaskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.workbaskets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.workbaskets;
CREATE POLICY tenant_isolation_policy ON workflow.workbaskets
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- CAP-036 — checklist / prerequisite-gating engine (template + per-entity run).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.checklist_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  code       varchar(64) NOT NULL,
  name       varchar(200) NOT NULL,
  items      jsonb NOT NULL DEFAULT '[]',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_tpl_code ON workflow.checklist_templates (tenant_id, code);
ALTER TABLE workflow.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.checklist_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.checklist_templates;
CREATE POLICY tenant_isolation_policy ON workflow.checklist_templates
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

CREATE TABLE IF NOT EXISTS workflow.checklist_instances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  template_id  uuid,
  entity_type  varchar(48) NOT NULL,
  entity_id    uuid NOT NULL,
  items        jsonb NOT NULL DEFAULT '[]',
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_inst_entity ON workflow.checklist_instances (tenant_id, entity_type, entity_id);
ALTER TABLE workflow.checklist_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.checklist_instances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.checklist_instances;
CREATE POLICY tenant_isolation_policy ON workflow.checklist_instances
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- CAP-040 — generic closure / reopen / archival lifecycle for any entity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.entity_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_type   varchar(48) NOT NULL,
  entity_id     uuid NOT NULL,
  status        varchar(12) NOT NULL DEFAULT 'open',
  closed_by     uuid,
  closed_at     timestamptz,
  closure_reason varchar(1000),
  reopened_by   uuid,
  reopened_at   timestamptz,
  reopen_reason varchar(1000),
  archived_by   uuid,
  archived_at   timestamptz,
  reopen_count  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT closure_status_ck CHECK (status IN ('open','closed','reopened','archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_closures ON workflow.entity_closures (tenant_id, entity_type, entity_id);
ALTER TABLE workflow.entity_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.entity_closures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.entity_closures;
CREATE POLICY tenant_isolation_policy ON workflow.entity_closures
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Runtime GRANTs — tables are owned by the migration role (civitas_admin);
-- the NOBYPASSRLS service role (workflow_svc) needs DML. Mirrors migration 0028.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workflow_svc') THEN
    GRANT USAGE ON SCHEMA workflow TO workflow_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      workflow.cases,
      workflow.case_deviations,
      workflow.case_links,
      workflow.deviation_requests,
      workflow.entity_comments,
      workflow.workbaskets,
      workflow.checklist_templates,
      workflow.checklist_instances,
      workflow.entity_closures
      TO workflow_svc;
  END IF;
END $$;
