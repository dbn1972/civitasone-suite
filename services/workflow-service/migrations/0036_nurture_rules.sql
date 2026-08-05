-- Purpose: Gap 3 — nurture workflow rules table for lead engagement triggers
-- Rollback: DROP TABLE IF EXISTS workflow.nurture_rules;
-- Affected services: workflow-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS workflow.nurture_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  trigger_type  text NOT NULL CHECK (trigger_type IN ('score_below', 'inactive_days', 'stage_change')),
  threshold     int NOT NULL DEFAULT 0,
  template_id   uuid NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  enabled       boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nurture_rules_tenant_trigger
  ON workflow.nurture_rules (tenant_id, trigger_type, enabled);

ALTER TABLE workflow.nurture_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'nurture_rules' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON workflow.nurture_rules
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
