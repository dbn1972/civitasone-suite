-- Purpose: tenants_status_check (0011_check_constraints_status_columns.sql) allowed
--   ('draft', 'active', 'suspended', 'decommissioned') — but the app's own state
--   machine (src/modules/tenant/domain.ts's ALLOWED transitions) and the canonical
--   TenantStatus type (packages/types) define six states: draft, active, suspended,
--   restricted, offboarding, archived. 'restricted'/'offboarding'/'archived' are
--   domain-legal transitions with no DB constraint allowing them — any route that
--   persists one (none currently do; only draft->active->suspended are wired to a
--   DB write today, so no production data has hit this) would fail with a hard
--   CHECK-constraint violation instead of succeeding. 'decommissioned' does not
--   exist anywhere in the type or domain logic — stale value from before a rename.
--   This migration re-syncs the constraint to the real six-state machine.
-- Rollback: re-add the old constraint —
--   ALTER TABLE tenant.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
--   ALTER TABLE tenant.tenants ADD CONSTRAINT tenants_status_check
--     CHECK (status IN ('draft', 'active', 'suspended', 'decommissioned')) NOT VALID;
-- Affected services: tenant-service

SET lock_timeout = '5s';

ALTER TABLE tenant.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;

DO $$ BEGIN
  ALTER TABLE tenant.tenants
    ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('draft', 'active', 'suspended', 'restricted', 'offboarding', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tenant.tenants VALIDATE CONSTRAINT tenants_status_check;
