-- RLS completion: full tenant isolation (USING + WITH CHECK) for audit-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION events.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- compliance.audit_checklists
ALTER TABLE compliance.audit_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_checklists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON compliance.audit_checklists;
DROP POLICY IF EXISTS tenant_isolation ON compliance.audit_checklists;
CREATE POLICY tenant_isolation_policy ON compliance.audit_checklists
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- compliance.audit_compliance_reports
ALTER TABLE compliance.audit_compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_compliance_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON compliance.audit_compliance_reports;
DROP POLICY IF EXISTS tenant_isolation ON compliance.audit_compliance_reports;
CREATE POLICY tenant_isolation_policy ON compliance.audit_compliance_reports
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- compliance.audit_pending_register
ALTER TABLE compliance.audit_pending_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_pending_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON compliance.audit_pending_register;
DROP POLICY IF EXISTS tenant_isolation ON compliance.audit_pending_register;
CREATE POLICY tenant_isolation_policy ON compliance.audit_pending_register
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- events.events
ALTER TABLE events.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events.events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON events.events;
DROP POLICY IF EXISTS tenant_isolation ON events.events;
CREATE POLICY tenant_isolation_policy ON events.events
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- exports.exports
ALTER TABLE exports.exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports.exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON exports.exports;
DROP POLICY IF EXISTS tenant_isolation ON exports.exports;
CREATE POLICY tenant_isolation_policy ON exports.exports
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- observation.audit_observations
ALTER TABLE observation.audit_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation.audit_observations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON observation.audit_observations;
DROP POLICY IF EXISTS tenant_isolation ON observation.audit_observations;
CREATE POLICY tenant_isolation_policy ON observation.audit_observations
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- observation.audit_working_papers
ALTER TABLE observation.audit_working_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation.audit_working_papers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON observation.audit_working_papers;
DROP POLICY IF EXISTS tenant_isolation ON observation.audit_working_papers;
CREATE POLICY tenant_isolation_policy ON observation.audit_working_papers
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- para.audit_dept_responses
ALTER TABLE para.audit_dept_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_dept_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON para.audit_dept_responses;
DROP POLICY IF EXISTS tenant_isolation ON para.audit_dept_responses;
CREATE POLICY tenant_isolation_policy ON para.audit_dept_responses
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- para.audit_para_status_history
ALTER TABLE para.audit_para_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_para_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON para.audit_para_status_history;
DROP POLICY IF EXISTS tenant_isolation ON para.audit_para_status_history;
CREATE POLICY tenant_isolation_policy ON para.audit_para_status_history
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- para.audit_paras
ALTER TABLE para.audit_paras ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_paras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON para.audit_paras;
DROP POLICY IF EXISTS tenant_isolation ON para.audit_paras;
CREATE POLICY tenant_isolation_policy ON para.audit_paras
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- plan.audit_plan_items
ALTER TABLE plan.audit_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan.audit_plan_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plan.audit_plan_items;
DROP POLICY IF EXISTS tenant_isolation ON plan.audit_plan_items;
CREATE POLICY tenant_isolation_policy ON plan.audit_plan_items
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- plan.audit_plans
ALTER TABLE plan.audit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan.audit_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plan.audit_plans;
DROP POLICY IF EXISTS tenant_isolation ON plan.audit_plans;
CREATE POLICY tenant_isolation_policy ON plan.audit_plans
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- plan.audit_teams
ALTER TABLE plan.audit_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan.audit_teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plan.audit_teams;
DROP POLICY IF EXISTS tenant_isolation ON plan.audit_teams;
CREATE POLICY tenant_isolation_policy ON plan.audit_teams
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- risk.audit_plan_risks
ALTER TABLE risk.audit_plan_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk.audit_plan_risks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON risk.audit_plan_risks;
DROP POLICY IF EXISTS tenant_isolation ON risk.audit_plan_risks;
CREATE POLICY tenant_isolation_policy ON risk.audit_plan_risks
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- risk.audit_risks
ALTER TABLE risk.audit_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk.audit_risks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON risk.audit_risks;
DROP POLICY IF EXISTS tenant_isolation ON risk.audit_risks;
CREATE POLICY tenant_isolation_policy ON risk.audit_risks
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = events.current_tenant_id())
      WITH CHECK (tenant_id = events.current_tenant_id())';
  END IF;
END $$;
