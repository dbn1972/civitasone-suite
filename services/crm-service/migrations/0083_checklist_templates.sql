-- ═══════════════════════════════════════════════════════════════════════════════
-- Purpose: G7 — crm.checklist_templates. Versioned, checklist-driven case templates
--   for the three product journeys that need one: exporter readiness documentation
--   (IEC / AD-code guidance), insurance proposal documentation (medical + verification
--   requirements), and B2B customer onboarding. Before this, crm.onboarding_cases
--   carried only `stage` + `kyc_status` and CRM had no checklist capability at all.
--
--   `sections` is the whole template body as JSONB. Shape (see @civitasone/checklist):
--     ChecklistSection[] = {
--       id, title, sortOrder, weight,
--       prerequisite?: { sectionId, minScore },
--       questions: {
--         id, text, type, sortOrder, weight, required, helpText?,
--         conditionalLogic?: { dependsOn, operator, value, action }[]
--       }[]
--     }[]
--
--   VERSIONED BY ROW. A published template is never destructively edited: instances
--   already reference its structure, so amending it in place would rewrite what an
--   in-flight case was asked. Amending means inserting a NEW row with the same
--   template_key and version_number + 1, hence the unique index on
--   (tenant_id, template_key, version_number).
--
-- Rollback: DROP TABLE IF EXISTS crm.checklist_templates;
--   (No data migration to undo — additive, new table only. Any rollback must also
--   drop crm.checklist_instances from 0084, which references template_id.)
--
-- Affected services: crm-service (modules/checklists)
-- Sequencing: additive and idempotent. No ALTER on an existing table, no DROP.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.checklist_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  template_key   varchar(64) NOT NULL,
  name           text NOT NULL,
  description    text,
  sections       jsonb NOT NULL DEFAULT '[]'::jsonb,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  status         varchar(16) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published', 'deprecated')),
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

-- One row per (tenant, key, version). This is what makes "publish a new version"
-- an INSERT rather than an UPDATE.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_checklist_templates_key_version
  ON crm.checklist_templates (tenant_id, template_key, version_number);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checklist_templates_tenant
  ON crm.checklist_templates (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checklist_templates_tenant_status
  ON crm.checklist_templates (tenant_id, status);

ALTER TABLE crm.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.checklist_templates FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'checklist_templates_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'checklist_templates'
  ) THEN
    CREATE POLICY checklist_templates_tenant_isolation ON crm.checklist_templates
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.checklist_templates TO crm_svc;
  END IF;
END $g$;
