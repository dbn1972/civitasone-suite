-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all analytics-service tables that carry tenant_id.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- analytics.dashboards
ALTER TABLE analytics.dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.dashboards;
CREATE POLICY tenant_isolation ON analytics.dashboards
  USING (tenant_id = current_tenant_id());

-- analytics.query_runs
ALTER TABLE analytics.query_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.query_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.query_runs;
CREATE POLICY tenant_isolation ON analytics.query_runs
  USING (tenant_id = current_tenant_id());

-- _outbox.messages
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id());

-- analytics.dashboard_widgets
ALTER TABLE analytics.dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_widgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.dashboard_widgets;
CREATE POLICY tenant_isolation ON analytics.dashboard_widgets
  USING (tenant_id = current_tenant_id());

-- analytics.dashboard_shares
ALTER TABLE analytics.dashboard_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.dashboard_shares;
CREATE POLICY tenant_isolation ON analytics.dashboard_shares
  USING (tenant_id = current_tenant_id());

-- analytics.saved_metrics
ALTER TABLE analytics.saved_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.saved_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.saved_metrics;
CREATE POLICY tenant_isolation ON analytics.saved_metrics
  USING (tenant_id = current_tenant_id());

-- analytics.fact_events
ALTER TABLE analytics.fact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.fact_events;
CREATE POLICY tenant_isolation ON analytics.fact_events
  USING (tenant_id = current_tenant_id());

-- analytics.scheduled_queries
ALTER TABLE analytics.scheduled_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.scheduled_queries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.scheduled_queries;
CREATE POLICY tenant_isolation ON analytics.scheduled_queries
  USING (tenant_id = current_tenant_id());

-- analytics.export_jobs
ALTER TABLE analytics.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.export_jobs;
CREATE POLICY tenant_isolation ON analytics.export_jobs
  USING (tenant_id = current_tenant_id());
