-- Purpose: OP-005 — stage ageing / stalled-opportunity tracking. deals.stage_entered_at
--   is stamped every time the stage changes; crm.stage_limits holds a per-tenant
--   (optionally per-pipeline) maximum number of days a deal may sit in a stage. The
--   stage-ageing dashboard lists opportunities whose days-in-stage exceeds the limit.
-- Rollback: DROP TABLE IF EXISTS crm.stage_limits;
--           ALTER TABLE crm.deals DROP COLUMN IF EXISTS stage_entered_at;
-- Affected services: crm-service (deals module)

SET lock_timeout = '5s';

-- Backfilled to updated_at so existing open deals get a sensible ageing baseline
-- instead of NULL; new rows default to now() and the consumer re-stamps on move.
ALTER TABLE crm.deals
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;
UPDATE crm.deals SET stage_entered_at = COALESCE(updated_at, created_at, now())
  WHERE stage_entered_at IS NULL;
ALTER TABLE crm.deals ALTER COLUMN stage_entered_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS crm.stage_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  -- NULL pipeline_id = a tenant-wide default limit for the named stage; a row with a
  -- pipeline_id overrides it for that pipeline.
  pipeline_id  uuid,
  stage        varchar(60) NOT NULL,
  max_days     integer NOT NULL CHECK (max_days > 0),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

-- One limit per (tenant, pipeline-or-default, stage). COALESCE keeps NULL pipeline_id
-- from defeating the unique constraint (NULLs are distinct otherwise).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_stage_limits_tenant_pipeline_stage
  ON crm.stage_limits (tenant_id, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid), stage);

ALTER TABLE crm.stage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.stage_limits FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='stage_limits' AND policyname='stage_limits_tenant_isolation') THEN
    CREATE POLICY stage_limits_tenant_isolation ON crm.stage_limits
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.stage_limits TO crm_svc;
  END IF;
END $g$;
