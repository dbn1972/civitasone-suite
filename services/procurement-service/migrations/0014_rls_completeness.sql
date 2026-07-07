-- RLS completeness: upgrade tenant_isolation_policy with WITH CHECK for
--          procurement.doc_counters (originally only had USING clause in 0010)
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON procurement.doc_counters; CREATE POLICY tenant_isolation ON procurement.doc_counters USING (tenant_id = indent.current_tenant_id());

SET lock_timeout = '5s';

-- procurement.doc_counters — upgrade to USING + WITH CHECK
ALTER TABLE procurement.doc_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.doc_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON procurement.doc_counters;
DROP POLICY IF EXISTS tenant_isolation ON procurement.doc_counters;
CREATE POLICY tenant_isolation_policy ON procurement.doc_counters
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());
