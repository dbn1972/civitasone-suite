-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all admin-service tables that carry tenant_id.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- tenants.admin_tenants
ALTER TABLE tenants.admin_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.admin_tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants.admin_tenants;
CREATE POLICY tenant_isolation ON tenants.admin_tenants
  USING (tenant_id = current_tenant_id());

-- config.admin_editions
ALTER TABLE config.admin_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.admin_editions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON config.admin_editions;
CREATE POLICY tenant_isolation ON config.admin_editions
  USING (tenant_id = current_tenant_id());

-- config.admin_module_configs
ALTER TABLE config.admin_module_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.admin_module_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON config.admin_module_configs;
CREATE POLICY tenant_isolation ON config.admin_module_configs
  USING (tenant_id = current_tenant_id());

-- config.admin_feature_flags
ALTER TABLE config.admin_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.admin_feature_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON config.admin_feature_flags;
CREATE POLICY tenant_isolation ON config.admin_feature_flags
  USING (tenant_id = current_tenant_id());

-- health.admin_health_snapshots
ALTER TABLE health.admin_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE health.admin_health_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health.admin_health_snapshots;
CREATE POLICY tenant_isolation ON health.admin_health_snapshots
  USING (tenant_id = current_tenant_id());

-- backup.admin_backup_schedules
ALTER TABLE backup.admin_backup_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.admin_backup_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON backup.admin_backup_schedules;
CREATE POLICY tenant_isolation ON backup.admin_backup_schedules
  USING (tenant_id = current_tenant_id());

-- backup.admin_backup_runs
ALTER TABLE backup.admin_backup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.admin_backup_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON backup.admin_backup_runs;
CREATE POLICY tenant_isolation ON backup.admin_backup_runs
  USING (tenant_id = current_tenant_id());

-- support.admin_break_glass_log
ALTER TABLE support.admin_break_glass_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.admin_break_glass_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support.admin_break_glass_log;
CREATE POLICY tenant_isolation ON support.admin_break_glass_log
  USING (tenant_id = current_tenant_id());

-- support.admin_support_tickets
ALTER TABLE support.admin_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.admin_support_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support.admin_support_tickets;
CREATE POLICY tenant_isolation ON support.admin_support_tickets
  USING (tenant_id = current_tenant_id());

-- _outbox.messages
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id());

-- api_keys.admin_api_keys
ALTER TABLE api_keys.admin_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys.admin_api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_keys.admin_api_keys;
CREATE POLICY tenant_isolation ON api_keys.admin_api_keys
  USING (tenant_id = current_tenant_id());
