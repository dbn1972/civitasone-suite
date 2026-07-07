-- Purpose: Create pipelines table and enhance deals with pipeline/stage references + closedAt
-- Rollback: DROP TABLE IF EXISTS crm.pipelines; ALTER TABLE crm.deals DROP COLUMN IF EXISTS pipeline_id, DROP COLUMN IF EXISTS stage_id, DROP COLUMN IF EXISTS closed_at;
-- Affected services: crm-service

SET lock_timeout = '5s';

-- Pipelines table: stores sales pipeline definitions with configurable stages (3-10 per pipeline)
CREATE TABLE IF NOT EXISTS crm.pipelines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL,
  name         varchar(200) NOT NULL,
  stages       jsonb        NOT NULL,
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pipelines_tenant ON crm.pipelines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_status ON crm.pipelines(tenant_id, status);

-- Enhance deals table: add pipeline reference, stage ID, and closed-at timestamp
ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS pipeline_id uuid;
ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS stage_id uuid;
ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON crm.deals(pipeline_id) WHERE pipeline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_stage ON crm.deals(stage_id) WHERE stage_id IS NOT NULL;

-- RLS enforcement on pipelines
ALTER TABLE crm.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.pipelines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON crm.pipelines;
CREATE POLICY tenant_isolation_policy ON crm.pipelines
  USING (tenant_id = crm.current_tenant_id())
  WITH CHECK (tenant_id = crm.current_tenant_id());

-- Stage count validation: 3-10 stages per pipeline enforced via CHECK constraint
ALTER TABLE crm.pipelines ADD CONSTRAINT chk_pipelines_stages_count
  CHECK (jsonb_array_length(stages) >= 3 AND jsonb_array_length(stages) <= 10);
