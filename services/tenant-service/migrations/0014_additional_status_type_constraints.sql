-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0011_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: tenant-service

SET lock_timeout = '5s';

-- ============================================================================
-- tenant.tenants.edition
-- Valid states: govt, psu, private, ngo, section8, cooperative, small_office
-- (validators.ts z.enum(["govt","psu","private","ngo","section8","cooperative",
-- "small_office"]); domain.ts TenantView.edition typed as same union;
-- onboard.ts and commands.ts persist the validated value directly)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tenant.tenants
    ADD CONSTRAINT tenants_edition_check
    CHECK (edition IN ('govt', 'psu', 'private', 'ngo', 'section8', 'cooperative', 'small_office'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- tenant.tenants.isolation_tier
-- Valid states: pool, silo
-- (domain.ts TenantView.isolationTier typed as "pool" | "silo";
-- commands.ts defaults to "pool" on creation; onboard.ts defaults "pool")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tenant.tenants
    ADD CONSTRAINT tenants_isolation_tier_check
    CHECK (isolation_tier IN ('pool', 'silo'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: tenant.tenants.status — already constrained by tenants_status_check
-- (0011) covering ('draft','active','suspended','decommissioned').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: plans.plans.edition — already uses pgEnum (edition) from schema
-- definition. No CHECK needed.
-- ============================================================================

-- ============================================================================
-- NOTE: subscriptions.subscriptions.status — already uses pgEnum
-- (subscription_status). No CHECK needed.
-- ============================================================================

-- ============================================================================
-- NOTE: quotas.quotas.resource — already uses pgEnum (quota_resource).
-- No CHECK needed.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE tenant.tenants VALIDATE CONSTRAINT tenants_edition_check;
ALTER TABLE tenant.tenants VALIDATE CONSTRAINT tenants_isolation_tier_check;
