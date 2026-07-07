-- RLS completion: full tenant isolation (USING + WITH CHECK) for notification-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION templates.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- alerts.alert_events
ALTER TABLE alerts.alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.alert_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON alerts.alert_events;
DROP POLICY IF EXISTS tenant_isolation ON alerts.alert_events;
CREATE POLICY tenant_isolation_policy ON alerts.alert_events
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- alerts.alert_rules
ALTER TABLE alerts.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.alert_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON alerts.alert_rules;
DROP POLICY IF EXISTS tenant_isolation ON alerts.alert_rules;
CREATE POLICY tenant_isolation_policy ON alerts.alert_rules
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- bulk.campaign_recipients
ALTER TABLE bulk.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk.campaign_recipients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON bulk.campaign_recipients;
DROP POLICY IF EXISTS tenant_isolation ON bulk.campaign_recipients;
CREATE POLICY tenant_isolation_policy ON bulk.campaign_recipients
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- bulk.campaigns
ALTER TABLE bulk.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk.campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON bulk.campaigns;
DROP POLICY IF EXISTS tenant_isolation ON bulk.campaigns;
CREATE POLICY tenant_isolation_policy ON bulk.campaigns
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- channels.channel_configs
ALTER TABLE channels.channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.channel_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON channels.channel_configs;
DROP POLICY IF EXISTS tenant_isolation ON channels.channel_configs;
CREATE POLICY tenant_isolation_policy ON channels.channel_configs
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- channels.channels
ALTER TABLE channels.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.channels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON channels.channels;
DROP POLICY IF EXISTS tenant_isolation ON channels.channels;
CREATE POLICY tenant_isolation_policy ON channels.channels
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- deliveries.deliveries
ALTER TABLE deliveries.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries.deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON deliveries.deliveries;
DROP POLICY IF EXISTS tenant_isolation ON deliveries.deliveries;
CREATE POLICY tenant_isolation_policy ON deliveries.deliveries
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- templates.prefs
ALTER TABLE templates.prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON templates.prefs;
DROP POLICY IF EXISTS tenant_isolation ON templates.prefs;
CREATE POLICY tenant_isolation_policy ON templates.prefs
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- templates.templates
ALTER TABLE templates.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON templates.templates;
DROP POLICY IF EXISTS tenant_isolation ON templates.templates;
CREATE POLICY tenant_isolation_policy ON templates.templates
  USING (tenant_id = templates.current_tenant_id())
  WITH CHECK (tenant_id = templates.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = templates.current_tenant_id())
      WITH CHECK (tenant_id = templates.current_tenant_id())';
  END IF;
END $$;
