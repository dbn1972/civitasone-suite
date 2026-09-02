-- 0128_recruitment_jd_templates.sql
--
-- Root cause: modules/recruitment/schema.ts declares hrmsJdTemplates
-- (table recruitment.hrms_jd_templates) and jd-template-repo.ts /
-- jd-template-routes.ts / consumer.ts all read and write it, but no
-- migration ever created the table. Every JD-template request (list,
-- get, create, use) 500s with `relation "recruitment.hrms_jd_templates"
-- does not exist` — see tests/jd-template.test.ts and
-- tests/jd-template-integration.test.ts (12 failures total).
--
-- Column list, types, defaults and nullability below are copied 1:1 from
-- the Drizzle declaration in modules/recruitment/schema.ts. No foreign
-- keys are declared there (created_by/updated_by/tenant_id are plain
-- uuid, same convention as recruitment.hrms_job_alerts in migration
-- 0100), so none are added here either.
--
-- RLS boilerplate (ENABLE + FORCE + tenant_id policy + GRANT to hrms_svc)
-- copied from the most structurally similar recruitment-module table,
-- recruitment.hrms_job_alerts (migration
-- 0100_nominee_address_leave_conversion.sql, lines 97-116).
--
-- Additive + idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Rollback:
--   DROP TABLE IF EXISTS recruitment.hrms_jd_templates;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_jd_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  name                varchar(200) NOT NULL,
  vacancy_type        varchar(24) NOT NULL DEFAULT 'regular',
  description         text,
  qualification       varchar(500),
  pay_range           varchar(120),
  selection_process   text,
  required_documents  jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility         jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags                text[],
  is_archived         boolean NOT NULL DEFAULT false,
  use_count           integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL
);

-- Supports listTemplates() in jd-template-repo.ts: WHERE tenant_id = ? AND
-- is_archived = false ORDER BY use_count DESC, created_at DESC.
CREATE INDEX IF NOT EXISTS hrms_jd_templates_tenant_idx
  ON recruitment.hrms_jd_templates (tenant_id, is_archived);

ALTER TABLE recruitment.hrms_jd_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_jd_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_jd_templates_tenant_isolation ON recruitment.hrms_jd_templates;
CREATE POLICY hrms_jd_templates_tenant_isolation ON recruitment.hrms_jd_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_jd_templates TO hrms_svc;
