-- Purpose: Gap 2 — store campaigns pending approval when bulk-send exceeds threshold
-- Rollback: DROP TABLE IF EXISTS crm.pending_campaigns;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.pending_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'sent')),
  channel       text NOT NULL,
  template_id   uuid NOT NULL,
  contact_ids   jsonb NOT NULL DEFAULT '[]',
  variables     jsonb NOT NULL DEFAULT '{}',
  scheduled_at  timestamptz,
  created_by    uuid NOT NULL,
  approved_by   uuid,
  rejected_by   uuid,
  rejection_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_campaigns_tenant_status
  ON crm.pending_campaigns (tenant_id, status);

ALTER TABLE crm.pending_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pending_campaigns' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON crm.pending_campaigns
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
