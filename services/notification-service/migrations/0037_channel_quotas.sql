-- G7: Channel quota enforcement for usage metering and billing integration
-- Tracks monthly send quotas per tenant per channel. Enforced pre-dispatch.
-- Rollback: DROP TABLE IF EXISTS channels.channel_quotas;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS channels.channel_quotas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  channel       varchar(16) NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'push')),
  monthly_limit bigint NOT NULL,
  used          bigint NOT NULL DEFAULT 0,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'unlimited')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, channel, period_start)
);

-- RLS
ALTER TABLE channels.channel_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.channel_quotas FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'channel_quotas' AND schemaname = 'channels' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON channels.channel_quotas
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_channel_quotas_tenant_period ON channels.channel_quotas (tenant_id, channel, period_start);

-- GRANT to service role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON channels.channel_quotas TO notification_svc;
  END IF;
END $$;
