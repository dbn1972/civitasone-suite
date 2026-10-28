-- 0021_ivr_actions.sql
-- UAT G2 #27: POST /v1/telephony/ivr-actions answered 201 but had nowhere to write, so configured IVR
-- digit actions (create_lead / send_sms) were silently discarded. This is the table the command consumer
-- (ivr/consumer.ts) now persists them to.
-- Idempotent. Rollback: DROP TABLE IF EXISTS telephony.ivr_actions;
SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS telephony.ivr_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  digit        varchar(4) NOT NULL,
  action       varchar(32) NOT NULL CHECK (action IN ('create_lead', 'send_sms')),
  template_id  uuid,
  lead_source  varchar(100),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      int NOT NULL DEFAULT 1
);
ALTER TABLE telephony.ivr_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.ivr_actions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ivr_actions' AND schemaname = 'telephony' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.ivr_actions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ivr_actions_tenant_digit
  ON telephony.ivr_actions (tenant_id, digit);
