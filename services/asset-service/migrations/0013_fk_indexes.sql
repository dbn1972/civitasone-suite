-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: asset-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- depreciation.asset_dep_schedules.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_dep_schedules_asset_id
  ON depreciation.asset_dep_schedules (asset_id);

-- depreciation.asset_dep_entries.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_dep_entries_asset_id
  ON depreciation.asset_dep_entries (asset_id);

-- depreciation.asset_dep_entries.schedule_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_dep_entries_schedule_id
  ON depreciation.asset_dep_entries (schedule_id);

-- enterprise.project_auc.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_auc_asset_id
  ON enterprise.project_auc (asset_id);

-- enterprise.asset_leases.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_leases_asset_id
  ON enterprise.asset_leases (asset_id);

-- enterprise.asset_impairments.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_impairments_asset_id
  ON enterprise.asset_impairments (asset_id);

-- enterprise.functional_locations.parent_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_functional_locations_parent_id
  ON enterprise.functional_locations (parent_id);

-- enterprise.spare_parts.work_order_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spare_parts_work_order_id
  ON enterprise.spare_parts (work_order_id);

-- insurance.asset_policies.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_policies_asset_id
  ON insurance.asset_policies (asset_id);

-- insurance.asset_claims.policy_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_claims_policy_id
  ON insurance.asset_claims (policy_id);

-- insurance.asset_claims.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_claims_asset_id
  ON insurance.asset_claims (asset_id);

-- lifecycle.asset_acquisitions.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_acquisitions_asset_id
  ON lifecycle.asset_acquisitions (asset_id);

-- lifecycle.asset_transfers.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_transfers_asset_id
  ON lifecycle.asset_transfers (asset_id);

-- lifecycle.asset_disposals.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_disposals_asset_id
  ON lifecycle.asset_disposals (asset_id);

-- lifecycle.pending_disposals.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pending_disposals_asset_id
  ON lifecycle.pending_disposals (asset_id);

-- maintenance.asset_maintenance_plans.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_maintenance_plans_asset_id
  ON maintenance.asset_maintenance_plans (asset_id);

-- maintenance.asset_work_orders.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_work_orders_asset_id
  ON maintenance.asset_work_orders (asset_id);

-- maintenance.asset_work_orders.plan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_work_orders_plan_id
  ON maintenance.asset_work_orders (plan_id);

-- maintenance.asset_meter_readings.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_meter_readings_asset_id
  ON maintenance.asset_meter_readings (asset_id);

-- register.asset_assets.auc_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_assets_auc_id
  ON register.asset_assets (auc_id);

-- lifecycle.physical_verification_items.verification_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physical_verification_items_verification_id
  ON lifecycle.physical_verification_items (verification_id);

-- lifecycle.physical_verification_items.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physical_verification_items_asset_id
  ON lifecycle.physical_verification_items (asset_id);

-- lifecycle.writeoff_approvals.asset_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_writeoff_approvals_asset_id
  ON lifecycle.writeoff_approvals (asset_id);
