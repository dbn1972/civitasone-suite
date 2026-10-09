-- 0028_plans_unique_tenant_code.sql
-- Purpose: GAP2-TENANT-PLANS-UNIQUE-05. plans.plans is a tenant-scoped table
--   (tenant_id NOT NULL, RLS forced) but its UNIQUE constraint is on `code`
--   alone (plans_code_key, from 0007's `code varchar(64) NOT NULL UNIQUE`).
--   That makes a plan `code` globally unique across ALL tenants, so two tenants
--   cannot each hold e.g. code='PSU' — the second tenant's INSERT fails with a
--   cross-tenant plans_code_key violation. Replace it with UNIQUE(tenant_id,
--   code) so the catalogue is unique per tenant, as a per-tenant table requires.
-- Rollback:
--   ALTER TABLE plans.plans DROP CONSTRAINT IF EXISTS plans_tenant_code_key;
--   ALTER TABLE plans.plans ADD CONSTRAINT plans_code_key UNIQUE (code);
-- Affected services: tenant-service
-- Operational notes: additive + idempotent. The drop/add is a metadata-only
--   change plus a unique-index build on (tenant_id, code); with a 5s
--   lock_timeout it aborts rather than blocking writes if it cannot acquire the
--   lock promptly. No data backfill is needed (the composite key is a superset
--   of the old single-column key, so any data valid under plans_code_key is
--   still valid under plans_tenant_code_key).

SET lock_timeout = '5s';

-- Drop the too-strict global-code UNIQUE (named plans_code_key by 0007's
-- inline `UNIQUE`). IF EXISTS keeps this idempotent / re-runnable.
ALTER TABLE plans.plans DROP CONSTRAINT IF EXISTS plans_code_key;

-- Add the correct per-tenant UNIQUE. Guarded on the constraint name so a
-- re-run is a no-op (the implicit unique index means a bare duplicate_object
-- handler is not enough — adding an existing constraint raises
-- duplicate_table / "relation already exists" from the index, so check
-- pg_constraint explicitly).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plans_tenant_code_key'
      AND conrelid = 'plans.plans'::regclass
  ) THEN
    ALTER TABLE plans.plans ADD CONSTRAINT plans_tenant_code_key UNIQUE (tenant_id, code);
  END IF;
END $$;
