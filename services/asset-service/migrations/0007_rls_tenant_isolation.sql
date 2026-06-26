-- asset-service RLS migration: tenant isolation backstop
-- Role: asset_svc on civitas_asset
-- Applied AFTER 0006_dual_book_and_gl.sql

CREATE OR REPLACE FUNCTION register.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- register schema
ALTER TABLE register.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE register.asset_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON register.asset_categories;
CREATE POLICY tenant_isolation ON register.asset_categories USING (tenant_id = register.current_tenant_id());

ALTER TABLE register.asset_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE register.asset_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON register.asset_assets;
CREATE POLICY tenant_isolation ON register.asset_assets USING (tenant_id = register.current_tenant_id());

-- lifecycle schema
ALTER TABLE lifecycle.asset_acquisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_acquisitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.asset_acquisitions;
CREATE POLICY tenant_isolation ON lifecycle.asset_acquisitions USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.asset_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.asset_transfers;
CREATE POLICY tenant_isolation ON lifecycle.asset_transfers USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.asset_disposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_disposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.asset_disposals;
CREATE POLICY tenant_isolation ON lifecycle.asset_disposals USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.physical_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.physical_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.physical_verifications;
CREATE POLICY tenant_isolation ON lifecycle.physical_verifications USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.physical_verification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.physical_verification_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.physical_verification_items;
CREATE POLICY tenant_isolation ON lifecycle.physical_verification_items USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.writeoff_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.writeoff_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.writeoff_approvals;
CREATE POLICY tenant_isolation ON lifecycle.writeoff_approvals USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.pending_disposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.pending_disposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.pending_disposals;
CREATE POLICY tenant_isolation ON lifecycle.pending_disposals USING (tenant_id = register.current_tenant_id());

ALTER TABLE lifecycle.inter_org_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.inter_org_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.inter_org_transfers;
CREATE POLICY tenant_isolation ON lifecycle.inter_org_transfers USING (tenant_id = register.current_tenant_id());

-- depreciation schema
ALTER TABLE depreciation.asset_dep_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation.asset_dep_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON depreciation.asset_dep_schedules;
CREATE POLICY tenant_isolation ON depreciation.asset_dep_schedules USING (tenant_id = register.current_tenant_id());

ALTER TABLE depreciation.asset_dep_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation.asset_dep_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON depreciation.asset_dep_entries;
CREATE POLICY tenant_isolation ON depreciation.asset_dep_entries USING (tenant_id = register.current_tenant_id());

-- maintenance schema
ALTER TABLE maintenance.asset_maintenance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.asset_maintenance_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON maintenance.asset_maintenance_plans;
CREATE POLICY tenant_isolation ON maintenance.asset_maintenance_plans USING (tenant_id = register.current_tenant_id());

ALTER TABLE maintenance.asset_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.asset_work_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON maintenance.asset_work_orders;
CREATE POLICY tenant_isolation ON maintenance.asset_work_orders USING (tenant_id = register.current_tenant_id());

-- insurance schema
ALTER TABLE insurance.asset_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance.asset_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON insurance.asset_policies;
CREATE POLICY tenant_isolation ON insurance.asset_policies USING (tenant_id = register.current_tenant_id());

ALTER TABLE insurance.asset_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance.asset_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON insurance.asset_claims;
CREATE POLICY tenant_isolation ON insurance.asset_claims USING (tenant_id = register.current_tenant_id());

-- enterprise schema
ALTER TABLE enterprise.project_auc ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.project_auc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.project_auc;
CREATE POLICY tenant_isolation ON enterprise.project_auc USING (tenant_id = register.current_tenant_id());

ALTER TABLE enterprise.asset_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.asset_leases;
CREATE POLICY tenant_isolation ON enterprise.asset_leases USING (tenant_id = register.current_tenant_id());

ALTER TABLE enterprise.asset_impairments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_impairments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.asset_impairments;
CREATE POLICY tenant_isolation ON enterprise.asset_impairments USING (tenant_id = register.current_tenant_id());

ALTER TABLE enterprise.functional_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.functional_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.functional_locations;
CREATE POLICY tenant_isolation ON enterprise.functional_locations USING (tenant_id = register.current_tenant_id());

ALTER TABLE enterprise.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.spare_parts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.spare_parts;
CREATE POLICY tenant_isolation ON enterprise.spare_parts USING (tenant_id = register.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = register.current_tenant_id());
