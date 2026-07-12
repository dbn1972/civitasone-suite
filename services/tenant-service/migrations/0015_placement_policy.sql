-- Purpose: Add nullable policy_version/policy_reason columns to tenant.tenants so the
--   edition-based Tenant_Placement_Policy (placement-policy.ts) can record which policy
--   version and reason (policy_mapped | fallback_default | manual_override) produced the
--   tenant's assigned isolation_tier at onboarding time, or was later overridden manually.
-- Rollback: ALTER TABLE tenant.tenants DROP COLUMN IF EXISTS policy_version;
--           ALTER TABLE tenant.tenants DROP COLUMN IF EXISTS policy_reason;
-- Affected services: tenant-service

SET lock_timeout = '5s';

-- ============================================================================
-- tenant.tenants.policy_version
-- Nullable text: the Tenant_Placement_Policy version string in effect when
-- isolation_tier was assigned. NULL for tenants onboarded before this feature
-- or whose tier was set purely by manual PATCH .../isolation.
--
-- tenant.tenants.policy_reason
-- Nullable varchar(24): one of policy_mapped | fallback_default | manual_override.
-- ============================================================================
ALTER TABLE tenant.tenants
  ADD COLUMN IF NOT EXISTS policy_version TEXT,
  ADD COLUMN IF NOT EXISTS policy_reason  VARCHAR(24);
