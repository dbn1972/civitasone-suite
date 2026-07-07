-- RLS completeness: upgrade USING-only policies to USING + WITH CHECK
-- Purpose: Add WITH CHECK clause for INSERT enforcement on
--          citizen.citizen_sla_config, citizen.sla_escalation_rules
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; recreate with USING-only.

SET lock_timeout = '5s';

-- citizen.citizen_sla_config
ALTER TABLE citizen.citizen_sla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.citizen_sla_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON citizen.citizen_sla_config;
DROP POLICY IF EXISTS tenant_isolation ON citizen.citizen_sla_config;
CREATE POLICY tenant_isolation_policy ON citizen.citizen_sla_config
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- citizen.sla_escalation_rules
ALTER TABLE citizen.sla_escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.sla_escalation_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON citizen.sla_escalation_rules;
DROP POLICY IF EXISTS tenant_isolation ON citizen.sla_escalation_rules;
CREATE POLICY tenant_isolation_policy ON citizen.sla_escalation_rules
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());
