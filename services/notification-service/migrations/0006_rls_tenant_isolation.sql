-- notification-service RLS migration: tenant isolation backstop
-- Role: notification_svc on civitas_notification
-- Applied AFTER 0005_prefs_tenant_scope.sql

CREATE OR REPLACE FUNCTION templates.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- templates schema
ALTER TABLE templates.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON templates.templates;
CREATE POLICY tenant_isolation ON templates.templates USING (tenant_id = templates.current_tenant_id());

ALTER TABLE templates.prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON templates.prefs;
CREATE POLICY tenant_isolation ON templates.prefs USING (tenant_id = templates.current_tenant_id());

-- deliveries schema
ALTER TABLE deliveries.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries.deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deliveries.deliveries;
CREATE POLICY tenant_isolation ON deliveries.deliveries USING (tenant_id = templates.current_tenant_id());

-- channels schema
ALTER TABLE channels.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.channels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON channels.channels;
CREATE POLICY tenant_isolation ON channels.channels USING (tenant_id = templates.current_tenant_id());

ALTER TABLE channels.channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels.channel_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON channels.channel_configs;
CREATE POLICY tenant_isolation ON channels.channel_configs USING (tenant_id = templates.current_tenant_id());

-- alerts schema
ALTER TABLE alerts.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.alert_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON alerts.alert_rules;
CREATE POLICY tenant_isolation ON alerts.alert_rules USING (tenant_id = templates.current_tenant_id());

ALTER TABLE alerts.alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.alert_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON alerts.alert_events;
CREATE POLICY tenant_isolation ON alerts.alert_events USING (tenant_id = templates.current_tenant_id());

-- bulk schema
ALTER TABLE bulk.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk.campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk.campaigns;
CREATE POLICY tenant_isolation ON bulk.campaigns USING (tenant_id = templates.current_tenant_id());

ALTER TABLE bulk.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk.campaign_recipients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk.campaign_recipients;
CREATE POLICY tenant_isolation ON bulk.campaign_recipients USING (tenant_id = templates.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = templates.current_tenant_id());
