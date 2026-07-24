-- revenue-service RLS migration: tenant isolation backstop
-- Role: revenue_svc on civitas_revenue
-- Applied AFTER 0001_init.sql
-- Rollback: DROP POLICY tenant_isolation on each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

-- Shared helper: resolve tenant_id from GUC set by app layer
CREATE OR REPLACE FUNCTION rates.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── rates schema ──────────────────────────────────────────────────────────────
ALTER TABLE rates.rate_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rate_heads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rates.rate_heads;
CREATE POLICY tenant_isolation ON rates.rate_heads USING (tenant_id = rates.current_tenant_id());

ALTER TABLE rates.rate_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rate_slabs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rates.rate_slabs;
CREATE POLICY tenant_isolation ON rates.rate_slabs USING (tenant_id = rates.current_tenant_id());

ALTER TABLE rates.penalty_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.penalty_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rates.penalty_rules;
CREATE POLICY tenant_isolation ON rates.penalty_rules USING (tenant_id = rates.current_tenant_id());

ALTER TABLE rates.rebate_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rebate_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rates.rebate_rules;
CREATE POLICY tenant_isolation ON rates.rebate_rules USING (tenant_id = rates.current_tenant_id());

-- ── assessee schema ───────────────────────────────────────────────────────────
ALTER TABLE assessee.assessees ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessee.assessees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assessee.assessees;
CREATE POLICY tenant_isolation ON assessee.assessees USING (tenant_id = rates.current_tenant_id());

-- ── assessment schema ─────────────────────────────────────────────────────────
ALTER TABLE assessment.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assessment.assessments;
CREATE POLICY tenant_isolation ON assessment.assessments USING (tenant_id = rates.current_tenant_id());

ALTER TABLE assessment.demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.demands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assessment.demands;
CREATE POLICY tenant_isolation ON assessment.demands USING (tenant_id = rates.current_tenant_id());

ALTER TABLE assessment.dcb_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.dcb_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assessment.dcb_entries;
CREATE POLICY tenant_isolation ON assessment.dcb_entries USING (tenant_id = rates.current_tenant_id());

ALTER TABLE assessment.remissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.remissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON assessment.remissions;
CREATE POLICY tenant_isolation ON assessment.remissions USING (tenant_id = rates.current_tenant_id());

-- ── billing schema ────────────────────────────────────────────────────────────
ALTER TABLE billing.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON billing.bills;
CREATE POLICY tenant_isolation ON billing.bills USING (tenant_id = rates.current_tenant_id());

-- ── collection schema ─────────────────────────────────────────────────────────
ALTER TABLE collection.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection.receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON collection.receipts;
CREATE POLICY tenant_isolation ON collection.receipts USING (tenant_id = rates.current_tenant_id());

ALTER TABLE collection.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection.refunds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON collection.refunds;
CREATE POLICY tenant_isolation ON collection.refunds USING (tenant_id = rates.current_tenant_id());

ALTER TABLE collection.adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection.adjustments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON collection.adjustments;
CREATE POLICY tenant_isolation ON collection.adjustments USING (tenant_id = rates.current_tenant_id());

-- ── arrears schema ────────────────────────────────────────────────────────────
ALTER TABLE arrears.instalment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrears.instalment_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON arrears.instalment_plans;
CREATE POLICY tenant_isolation ON arrears.instalment_plans USING (tenant_id = rates.current_tenant_id());

ALTER TABLE arrears.instalments ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrears.instalments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON arrears.instalments;
CREATE POLICY tenant_isolation ON arrears.instalments USING (tenant_id = rates.current_tenant_id());

ALTER TABLE arrears.write_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrears.write_offs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON arrears.write_offs;
CREATE POLICY tenant_isolation ON arrears.write_offs USING (tenant_id = rates.current_tenant_id());

ALTER TABLE arrears.recovery_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrears.recovery_referrals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON arrears.recovery_referrals;
CREATE POLICY tenant_isolation ON arrears.recovery_referrals USING (tenant_id = rates.current_tenant_id());

-- ── bbps schema ───────────────────────────────────────────────────────────────
ALTER TABLE bbps.biller_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbps.biller_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bbps.biller_config;
CREATE POLICY tenant_isolation ON bbps.biller_config USING (tenant_id = rates.current_tenant_id());

ALTER TABLE bbps.bbps_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbps.bbps_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bbps.bbps_transactions;
CREATE POLICY tenant_isolation ON bbps.bbps_transactions USING (tenant_id = rates.current_tenant_id());

-- ── outbox ────────────────────────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = rates.current_tenant_id());
