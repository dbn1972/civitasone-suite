-- RLS completion: full tenant isolation (USING + WITH CHECK) for admin-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- api_keys.admin_api_keys
ALTER TABLE api_keys.admin_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys.admin_api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON api_keys.admin_api_keys;
DROP POLICY IF EXISTS tenant_isolation ON api_keys.admin_api_keys;
CREATE POLICY tenant_isolation_policy ON api_keys.admin_api_keys
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- backup.admin_backup_runs
ALTER TABLE backup.admin_backup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.admin_backup_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON backup.admin_backup_runs;
DROP POLICY IF EXISTS tenant_isolation ON backup.admin_backup_runs;
CREATE POLICY tenant_isolation_policy ON backup.admin_backup_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- backup.admin_backup_schedules
ALTER TABLE backup.admin_backup_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.admin_backup_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON backup.admin_backup_schedules;
DROP POLICY IF EXISTS tenant_isolation ON backup.admin_backup_schedules;
CREATE POLICY tenant_isolation_policy ON backup.admin_backup_schedules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- config.admin_editions
ALTER TABLE config.admin_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.admin_editions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON config.admin_editions;
DROP POLICY IF EXISTS tenant_isolation ON config.admin_editions;
CREATE POLICY tenant_isolation_policy ON config.admin_editions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- config.admin_feature_flags
ALTER TABLE config.admin_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.admin_feature_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON config.admin_feature_flags;
DROP POLICY IF EXISTS tenant_isolation ON config.admin_feature_flags;
CREATE POLICY tenant_isolation_policy ON config.admin_feature_flags
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- config.admin_module_configs
ALTER TABLE config.admin_module_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.admin_module_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON config.admin_module_configs;
DROP POLICY IF EXISTS tenant_isolation ON config.admin_module_configs;
CREATE POLICY tenant_isolation_policy ON config.admin_module_configs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- custom_domains.custom_domains
ALTER TABLE custom_domains.custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains.custom_domains FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON custom_domains.custom_domains;
DROP POLICY IF EXISTS tenant_isolation ON custom_domains.custom_domains;
CREATE POLICY tenant_isolation_policy ON custom_domains.custom_domains
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- data_export.export_requests
ALTER TABLE data_export.export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_export.export_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON data_export.export_requests;
DROP POLICY IF EXISTS tenant_isolation ON data_export.export_requests;
CREATE POLICY tenant_isolation_policy ON data_export.export_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- feature_flags.feature_flags
ALTER TABLE feature_flags.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags.feature_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON feature_flags.feature_flags;
DROP POLICY IF EXISTS tenant_isolation ON feature_flags.feature_flags;
CREATE POLICY tenant_isolation_policy ON feature_flags.feature_flags
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- health.admin_health_snapshots
ALTER TABLE health.admin_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE health.admin_health_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON health.admin_health_snapshots;
DROP POLICY IF EXISTS tenant_isolation ON health.admin_health_snapshots;
CREATE POLICY tenant_isolation_policy ON health.admin_health_snapshots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- scheduled_jobs.job_execution_history
ALTER TABLE scheduled_jobs.job_execution_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs.job_execution_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheduled_jobs.job_execution_history;
DROP POLICY IF EXISTS tenant_isolation ON scheduled_jobs.job_execution_history;
CREATE POLICY tenant_isolation_policy ON scheduled_jobs.job_execution_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- scheduled_jobs.scheduled_jobs
ALTER TABLE scheduled_jobs.scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs.scheduled_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheduled_jobs.scheduled_jobs;
DROP POLICY IF EXISTS tenant_isolation ON scheduled_jobs.scheduled_jobs;
CREATE POLICY tenant_isolation_policy ON scheduled_jobs.scheduled_jobs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- support.admin_break_glass_log
ALTER TABLE support.admin_break_glass_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.admin_break_glass_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON support.admin_break_glass_log;
DROP POLICY IF EXISTS tenant_isolation ON support.admin_break_glass_log;
CREATE POLICY tenant_isolation_policy ON support.admin_break_glass_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- support.admin_support_tickets
ALTER TABLE support.admin_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.admin_support_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON support.admin_support_tickets;
DROP POLICY IF EXISTS tenant_isolation ON support.admin_support_tickets;
CREATE POLICY tenant_isolation_policy ON support.admin_support_tickets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- tenants.admin_tenants
ALTER TABLE tenants.admin_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.admin_tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenants.admin_tenants;
DROP POLICY IF EXISTS tenant_isolation ON tenants.admin_tenants;
CREATE POLICY tenant_isolation_policy ON tenants.admin_tenants
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- webhooks.webhooks
ALTER TABLE webhooks.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks.webhooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON webhooks.webhooks;
DROP POLICY IF EXISTS tenant_isolation ON webhooks.webhooks;
CREATE POLICY tenant_isolation_policy ON webhooks.webhooks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
