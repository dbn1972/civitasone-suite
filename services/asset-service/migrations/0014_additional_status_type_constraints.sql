-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0011_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: asset-service

SET lock_timeout = '5s';

-- ============================================================================
-- register.asset_assets.asset_type
-- Valid states: fixed, infra, movable, it, vehicle, other (source:
-- modules/register/validators.ts assetType enum; schema.ts default "other")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE register.asset_assets
    ADD CONSTRAINT asset_assets_asset_type_check
    CHECK (asset_type IN ('fixed', 'infra', 'movable', 'it', 'vehicle', 'other'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- maintenance.asset_maintenance_plans.trigger_type
-- Valid states: calendar, meter, condition, both (source: modules/maintenance
-- /validators.ts triggerType enum; schema.ts default "calendar"). NOTE: this
-- column already carries an inline CHECK from migration
-- 0008_meter_readings_impairment_test.sql (unnamed -> Postgres auto-named it
-- maintenance.asset_maintenance_plans_trigger_type_check, the same name this
-- migration uses), so this ADD CONSTRAINT is expected to no-op via
-- duplicate_object on environments that already ran 0008. Included here for
-- completeness/documentation and to guarantee the constraint exists even on
-- environments where 0008 was skipped or the column was added without it.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE maintenance.asset_maintenance_plans
    ADD CONSTRAINT asset_maintenance_plans_trigger_type_check
    CHECK (trigger_type IN ('calendar', 'meter', 'condition', 'both'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- maintenance.asset_maintenance_plans.meter_type
-- Valid states: odometer, hours_run, cycles, temperature, vibration, custom
-- (source: modules/maintenance/validators.ts meterType enum — shared with
-- maintenance.asset_meter_readings.meter_type, which already has this exact
-- CHECK per 0008_meter_readings_impairment_test.sql). Column is nullable
-- (no trigger requires a meter type unless trigger_type = 'meter'), so NULL
-- is explicitly allowed.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE maintenance.asset_maintenance_plans
    ADD CONSTRAINT asset_maintenance_plans_meter_type_check
    CHECK (meter_type IS NULL OR meter_type IN ('odometer', 'hours_run', 'cycles', 'temperature', 'vibration', 'custom'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE register.asset_assets VALIDATE CONSTRAINT asset_assets_asset_type_check;
ALTER TABLE maintenance.asset_maintenance_plans VALIDATE CONSTRAINT asset_maintenance_plans_trigger_type_check;
ALTER TABLE maintenance.asset_maintenance_plans VALIDATE CONSTRAINT asset_maintenance_plans_meter_type_check;
