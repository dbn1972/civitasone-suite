-- Purpose: G2 (spec §25) — crm.journey_templates, the configurable journey template.
--   "Each journey is a configurable template: circles may adapt steps, SLAs and
--   communication templates without code change, but the canonical stage vocabulary and
--   measurement points are standardised nationally so that dashboards aggregate cleanly."
--
--   A template is a versioned, scoped list of steps. Each step names a stage_code from
--   crm.stage_vocabulary (0079) — that link is what keeps two tenants' funnels
--   comparable. parent_template_id is the derivation link: a child template may adapt
--   step DETAIL (sla_hours, communication_template_ref, mandatory_fields,
--   assignment_rule) but may not introduce unknown stage codes, drop a required parent
--   step, or reorder canonical stages against the vocabulary ordinals.
--
--   VERSIONED BY ROW. A published template is never edited in place: publishing a changed
--   definition inserts a NEW row with version_number + 1 and deprecates the row it
--   supersedes. Journey instances hold a template row id, so editing a published row
--   would silently rewrite the meaning of history.
--
-- Rollback: DROP TABLE IF EXISTS crm.journey_templates;
-- Affected services: crm-service (journeys module)
-- Sequencing: additive — new table only, no backfill, no change to existing tables.
--   The (tenant_id, template_key, version_number) uniqueness and the canonical
--   immutability trigger are added in 0081.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.journey_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_key varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  description varchar(1000),
  governance varchar(16) NOT NULL DEFAULT 'tenant'
    CHECK (governance IN ('canonical', 'tenant')),
  -- Derivation link. Nullable: a root (national) template has no parent. Deliberately
  -- NOT a FK — a canonical parent lives under the platform sentinel tenant while the
  -- child belongs to a real tenant, so a composite (tenant_id, id) FK cannot express it
  -- and a bare id FK would let a parent be deleted out from under a child in another
  -- tenant. Existence is checked in the application layer, which answers 422 with a
  -- code the caller can act on.
  parent_template_id uuid,
  -- Scope columns mirror crm.pipelines (OP-002): a NULL column means "any".
  product varchar(120),
  region varchar(120),
  business_unit varchar(120),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  version_number integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'deprecated')),
  published_at timestamptz,
  deprecated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_journey_templates_steps_array CHECK (jsonb_typeof(steps) = 'array')
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journey_templates_tenant
  ON crm.journey_templates (tenant_id, template_key, version_number DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journey_templates_status
  ON crm.journey_templates (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journey_templates_parent
  ON crm.journey_templates (parent_template_id) WHERE parent_template_id IS NOT NULL;

ALTER TABLE crm.journey_templates ENABLE ROW LEVEL SECURITY;

-- Same visibility rule as crm.stage_vocabulary: a canonical (national) template is
-- readable by every tenant so it can be derived from, tenant templates are private.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'journey_templates_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'journey_templates'
  ) THEN
    CREATE POLICY journey_templates_tenant_isolation ON crm.journey_templates
      USING (
        tenant_id::text = current_setting('app.tenant_id', true)
        OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
      );
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.journey_templates TO crm_svc;
  END IF;
END $g$;
