-- Purpose: G1 (spec §25) — crm.stage_vocabulary, the CANONICAL journey stage vocabulary.
--   Today crm.pipelines carries per-tenant free-form stage names, so two circles running
--   the same journey produce funnels that cannot be added together. This table holds the
--   stable machine keys (stage_code) that national dashboards aggregate on.
--
--   Governance:
--     'canonical' rows are owned by the PLATFORM, not by a tenant. They live under the
--     sentinel tenant 00000000-0000-0000-0000-000000000000 and are visible to every
--     tenant through the RLS policy below. They are IMMUTABLE — see migration 0081 for
--     the trigger that refuses UPDATE/DELETE at the database, which is what makes
--     immutability true regardless of the caller's role. A canonical vocabulary a tenant
--     can rename is not canonical.
--     'tenant' rows are owned by the tenant that created them and are freely mutable.
--
-- Rollback: DROP TABLE IF EXISTS crm.stage_vocabulary;
--   (no other table has a FK onto it — crm.journey_templates references stage codes from
--    JSONB steps and is validated in the application layer, so dropping is safe.)
-- Affected services: crm-service (journeys module)
-- Sequencing: additive — new table only, no backfill, no change to existing tables.
--   The canonical seed rows are a SEPARATE data migration (0082).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.stage_vocabulary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  stage_code varchar(64) NOT NULL,
  display_name varchar(200) NOT NULL,
  description varchar(1000),
  ordinal integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT false,
  governance varchar(16) NOT NULL DEFAULT 'tenant'
    CHECK (governance IN ('canonical', 'tenant')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_stage_vocabulary_code UNIQUE (tenant_id, stage_code)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stage_vocabulary_tenant
  ON crm.stage_vocabulary (tenant_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stage_vocabulary_governance
  ON crm.stage_vocabulary (governance, stage_code) WHERE deleted_at IS NULL;

ALTER TABLE crm.stage_vocabulary ENABLE ROW LEVEL SECURITY;

-- The canonical rows are deliberately readable by EVERY tenant: a national vocabulary
-- that each tenant had to be given its own copy of would drift the moment one copy was
-- edited, which is the problem this table exists to remove.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'stage_vocabulary_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'stage_vocabulary'
  ) THEN
    CREATE POLICY stage_vocabulary_tenant_isolation ON crm.stage_vocabulary
      USING (
        tenant_id::text = current_setting('app.tenant_id', true)
        OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
      );
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.stage_vocabulary TO crm_svc;
  END IF;
END $g$;
