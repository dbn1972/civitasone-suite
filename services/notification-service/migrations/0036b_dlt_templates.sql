-- G8: DLT (TRAI) template validation for Indian SMS/WhatsApp
-- Stores DLT-registered templates so outbound messages can be validated before dispatch.
-- Rollback: DROP TABLE IF EXISTS dlt.dlt_templates; DROP SCHEMA IF EXISTS dlt;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS dlt;

CREATE TABLE IF NOT EXISTS dlt.dlt_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_id     varchar(32) NOT NULL,
  template_id   varchar(32) NOT NULL,
  header_id     varchar(16) NOT NULL,
  content_type  varchar(16) NOT NULL CHECK (content_type IN ('promotional', 'transactional', 'service_implicit', 'service_explicit')),
  template_body text NOT NULL,
  channel       varchar(16) NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  status        varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  registered_at timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, template_id, channel)
);

-- RLS
ALTER TABLE dlt.dlt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dlt.dlt_templates FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dlt_templates' AND schemaname = 'dlt' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON dlt.dlt_templates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dlt_templates_tenant_channel ON dlt.dlt_templates (tenant_id, channel, status);

-- GRANT to service role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_svc') THEN
    GRANT USAGE ON SCHEMA dlt TO notification_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON dlt.dlt_templates TO notification_svc;
  END IF;
END $$;
