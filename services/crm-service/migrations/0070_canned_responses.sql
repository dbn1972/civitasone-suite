-- Purpose: Gap 5 — canned responses (quick-reply templates) for agents
-- Rollback: DROP TABLE IF EXISTS crm.canned_responses;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.canned_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'any')),
  category      text,
  shortcut_key  text,
  created_by    uuid NOT NULL,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canned_responses_tenant_category
  ON crm.canned_responses (tenant_id, category);

ALTER TABLE crm.canned_responses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'canned_responses' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON crm.canned_responses
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
