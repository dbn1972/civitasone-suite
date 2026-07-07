-- RLS completion: full tenant isolation (USING + WITH CHECK) for asset-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION register.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- depreciation.asset_dep_entries
ALTER TABLE depreciation.asset_dep_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation.asset_dep_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON depreciation.asset_dep_entries;
DROP POLICY IF EXISTS tenant_isolation ON depreciation.asset_dep_entries;
CREATE POLICY tenant_isolation_policy ON depreciation.asset_dep_entries
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- depreciation.asset_dep_schedules
ALTER TABLE depreciation.asset_dep_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation.asset_dep_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON depreciation.asset_dep_schedules;
DROP POLICY IF EXISTS tenant_isolation ON depreciation.asset_dep_schedules;
CREATE POLICY tenant_isolation_policy ON depreciation.asset_dep_schedules
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- enterprise.asset_impairments
ALTER TABLE enterprise.asset_impairments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_impairments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.asset_impairments;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.asset_impairments;
CREATE POLICY tenant_isolation_policy ON enterprise.asset_impairments
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- enterprise.asset_leases
ALTER TABLE enterprise.asset_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.asset_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.asset_leases;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.asset_leases;
CREATE POLICY tenant_isolation_policy ON enterprise.asset_leases
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- enterprise.functional_locations
ALTER TABLE enterprise.functional_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.functional_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.functional_locations;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.functional_locations;
CREATE POLICY tenant_isolation_policy ON enterprise.functional_locations
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- enterprise.project_auc
ALTER TABLE enterprise.project_auc ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.project_auc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.project_auc;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.project_auc;
CREATE POLICY tenant_isolation_policy ON enterprise.project_auc
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- enterprise.spare_parts
ALTER TABLE enterprise.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.spare_parts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.spare_parts;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.spare_parts;
CREATE POLICY tenant_isolation_policy ON enterprise.spare_parts
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- insurance.asset_claims
ALTER TABLE insurance.asset_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance.asset_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON insurance.asset_claims;
DROP POLICY IF EXISTS tenant_isolation ON insurance.asset_claims;
CREATE POLICY tenant_isolation_policy ON insurance.asset_claims
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- insurance.asset_policies
ALTER TABLE insurance.asset_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance.asset_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON insurance.asset_policies;
DROP POLICY IF EXISTS tenant_isolation ON insurance.asset_policies;
CREATE POLICY tenant_isolation_policy ON insurance.asset_policies
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.asset_acquisitions
ALTER TABLE lifecycle.asset_acquisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_acquisitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.asset_acquisitions;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.asset_acquisitions;
CREATE POLICY tenant_isolation_policy ON lifecycle.asset_acquisitions
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.asset_disposals
ALTER TABLE lifecycle.asset_disposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_disposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.asset_disposals;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.asset_disposals;
CREATE POLICY tenant_isolation_policy ON lifecycle.asset_disposals
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.asset_transfers
ALTER TABLE lifecycle.asset_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.asset_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.asset_transfers;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.asset_transfers;
CREATE POLICY tenant_isolation_policy ON lifecycle.asset_transfers
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.pending_disposals
ALTER TABLE lifecycle.pending_disposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.pending_disposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.pending_disposals;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.pending_disposals;
CREATE POLICY tenant_isolation_policy ON lifecycle.pending_disposals
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.physical_verification_items
ALTER TABLE lifecycle.physical_verification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.physical_verification_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.physical_verification_items;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.physical_verification_items;
CREATE POLICY tenant_isolation_policy ON lifecycle.physical_verification_items
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.physical_verifications
ALTER TABLE lifecycle.physical_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.physical_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.physical_verifications;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.physical_verifications;
CREATE POLICY tenant_isolation_policy ON lifecycle.physical_verifications
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.writeoff_approvals
ALTER TABLE lifecycle.writeoff_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.writeoff_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.writeoff_approvals;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.writeoff_approvals;
CREATE POLICY tenant_isolation_policy ON lifecycle.writeoff_approvals
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- maintenance.asset_maintenance_plans
ALTER TABLE maintenance.asset_maintenance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.asset_maintenance_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON maintenance.asset_maintenance_plans;
DROP POLICY IF EXISTS tenant_isolation ON maintenance.asset_maintenance_plans;
CREATE POLICY tenant_isolation_policy ON maintenance.asset_maintenance_plans
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- maintenance.asset_meter_readings
ALTER TABLE maintenance.asset_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.asset_meter_readings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON maintenance.asset_meter_readings;
DROP POLICY IF EXISTS tenant_isolation ON maintenance.asset_meter_readings;
CREATE POLICY tenant_isolation_policy ON maintenance.asset_meter_readings
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- maintenance.asset_work_orders
ALTER TABLE maintenance.asset_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance.asset_work_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON maintenance.asset_work_orders;
DROP POLICY IF EXISTS tenant_isolation ON maintenance.asset_work_orders;
CREATE POLICY tenant_isolation_policy ON maintenance.asset_work_orders
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- register.asset_assets
ALTER TABLE register.asset_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE register.asset_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON register.asset_assets;
DROP POLICY IF EXISTS tenant_isolation ON register.asset_assets;
CREATE POLICY tenant_isolation_policy ON register.asset_assets
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- register.asset_categories
ALTER TABLE register.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE register.asset_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON register.asset_categories;
DROP POLICY IF EXISTS tenant_isolation ON register.asset_categories;
CREATE POLICY tenant_isolation_policy ON register.asset_categories
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = register.current_tenant_id())
      WITH CHECK (tenant_id = register.current_tenant_id())';
  END IF;
END $$;
