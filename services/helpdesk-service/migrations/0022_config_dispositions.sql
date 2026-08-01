-- Purpose: Create dispositions table for resolution dispositions master (CFG-05)
-- Rollback: DROP TABLE IF EXISTS helpdesk.dispositions;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.dispositions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  label       varchar(128) NOT NULL,
  category    varchar(64),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispositions_tenant_id
  ON helpdesk.dispositions (tenant_id);

-- RLS
ALTER TABLE helpdesk.dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.dispositions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dispositions' AND policyname = 'dispositions_tenant_isolation'
  ) THEN
    CREATE POLICY dispositions_tenant_isolation ON helpdesk.dispositions
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.dispositions TO helpdesk_svc;
