-- SEC-009: RLS ENABLE without FORCE on service-owned tables.
-- workflow_svc owns workflow.nurture_rules (0036_nurture_rules.sql); the
-- owning role silently bypasses its own tenant_isolation policy without
-- FORCE. See packages/db/src/tenant-scope.ts:20.
-- Rollback: ALTER TABLE workflow.nurture_rules NO FORCE ROW LEVEL SECURITY;

ALTER TABLE workflow.nurture_rules FORCE ROW LEVEL SECURITY;
