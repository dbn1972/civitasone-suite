-- audit-service RLS migration: tenant isolation backstop
-- Role: audit_svc on civitas_audit
-- Applied AFTER 0009_export_signing.sql
-- Additive only — no DROP TABLE, no ALTER COLUMN, no data changes.
-- NOTE: events.events is APPEND-ONLY per service contract (no UPDATE/DELETE
--       issued by audit_svc) — RLS is applied for defence-in-depth.

-- Helper function: reads app.tenant_id from session variable (SET LOCAL by middleware)
CREATE OR REPLACE FUNCTION events.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── events schema ─────────────────────────────────────────────────
ALTER TABLE events.events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events.events  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON events.events;
CREATE POLICY tenant_isolation ON events.events
  USING (tenant_id = events.current_tenant_id());

-- ── observation schema ────────────────────────────────────────────
ALTER TABLE observation.audit_observations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation.audit_working_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation.audit_observations   FORCE ROW LEVEL SECURITY;
ALTER TABLE observation.audit_working_papers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON observation.audit_observations;
DROP POLICY IF EXISTS tenant_isolation ON observation.audit_working_papers;

CREATE POLICY tenant_isolation ON observation.audit_observations
  USING (tenant_id = events.current_tenant_id());
CREATE POLICY tenant_isolation ON observation.audit_working_papers
  USING (tenant_id = events.current_tenant_id());

-- ── para schema ───────────────────────────────────────────────────
ALTER TABLE para.audit_paras              ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_dept_responses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_para_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_paras              FORCE ROW LEVEL SECURITY;
ALTER TABLE para.audit_dept_responses     FORCE ROW LEVEL SECURITY;
ALTER TABLE para.audit_para_status_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON para.audit_paras;
DROP POLICY IF EXISTS tenant_isolation ON para.audit_dept_responses;
DROP POLICY IF EXISTS tenant_isolation ON para.audit_para_status_history;

CREATE POLICY tenant_isolation ON para.audit_paras
  USING (tenant_id = events.current_tenant_id());
CREATE POLICY tenant_isolation ON para.audit_dept_responses
  USING (tenant_id = events.current_tenant_id());
CREATE POLICY tenant_isolation ON para.audit_para_status_history
  USING (tenant_id = events.current_tenant_id());

-- ── compliance schema ─────────────────────────────────────────────
ALTER TABLE compliance.audit_compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_compliance_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON compliance.audit_compliance_reports;
CREATE POLICY tenant_isolation ON compliance.audit_compliance_reports
  USING (tenant_id = events.current_tenant_id());

-- ── _outbox schema ────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = events.current_tenant_id());
