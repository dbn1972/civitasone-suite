-- RLS completion: full tenant isolation (USING + WITH CHECK) for analytics-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- analytics.dashboard_shares
ALTER TABLE analytics.dashboard_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.dashboard_shares;
DROP POLICY IF EXISTS tenant_isolation ON analytics.dashboard_shares;
CREATE POLICY tenant_isolation_policy ON analytics.dashboard_shares
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.dashboard_widgets
ALTER TABLE analytics.dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_widgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.dashboard_widgets;
DROP POLICY IF EXISTS tenant_isolation ON analytics.dashboard_widgets;
CREATE POLICY tenant_isolation_policy ON analytics.dashboard_widgets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.dashboards
ALTER TABLE analytics.dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.dashboards;
DROP POLICY IF EXISTS tenant_isolation ON analytics.dashboards;
CREATE POLICY tenant_isolation_policy ON analytics.dashboards
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.export_jobs
ALTER TABLE analytics.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.export_jobs;
DROP POLICY IF EXISTS tenant_isolation ON analytics.export_jobs;
CREATE POLICY tenant_isolation_policy ON analytics.export_jobs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.fact_events
ALTER TABLE analytics.fact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.fact_events;
DROP POLICY IF EXISTS tenant_isolation ON analytics.fact_events;
CREATE POLICY tenant_isolation_policy ON analytics.fact_events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.query_runs
ALTER TABLE analytics.query_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.query_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.query_runs;
DROP POLICY IF EXISTS tenant_isolation ON analytics.query_runs;
CREATE POLICY tenant_isolation_policy ON analytics.query_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.saved_metrics
ALTER TABLE analytics.saved_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.saved_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.saved_metrics;
DROP POLICY IF EXISTS tenant_isolation ON analytics.saved_metrics;
CREATE POLICY tenant_isolation_policy ON analytics.saved_metrics
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- analytics.scheduled_queries
ALTER TABLE analytics.scheduled_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.scheduled_queries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.scheduled_queries;
DROP POLICY IF EXISTS tenant_isolation ON analytics.scheduled_queries;
CREATE POLICY tenant_isolation_policy ON analytics.scheduled_queries
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
