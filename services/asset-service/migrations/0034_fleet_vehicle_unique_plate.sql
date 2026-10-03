-- Migration: 0034_fleet_vehicle_unique_plate.sql
-- One live vehicle per normalised registration plate per tenant
-- (GAP-ASSETS-FLEET-VEHICLES-05). The route pre-check is racy (two concurrent
-- creates both pass it); this index is the database backstop. "Normalised" =
-- upper-case with spaces/hyphens stripped, the same rule the route and web use.
-- Decommissioned vehicles are excluded so a plate can be re-registered.
--
-- EXISTING DUPLICATES: nothing is deleted, renamed or merged. If any tenant
-- already has two live vehicles on one normalised plate, the index is NOT
-- created, a NOTICE lists the offending groups, and the migration still
-- succeeds. A human resolves them (decommission or correct the plate) and
-- re-runs this file -- it is idempotent. Until then the route pre-check and
-- consumer still guard the common case.
-- Rollback: DROP INDEX IF EXISTS asset.uq_fleet_vehicles_tenant_plate;

SET lock_timeout = '5s';

DO $$
DECLARE
  dup_count integer;
  dup record;
BEGIN
  IF to_regclass('asset.uq_fleet_vehicles_tenant_plate') IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT 1 FROM asset.fleet_vehicles
     WHERE status <> 'decommissioned'
     GROUP BY tenant_id, upper(regexp_replace(registration_no, '[[:space:]-]+', '', 'g'))
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    FOR dup IN
      SELECT tenant_id,
             upper(regexp_replace(registration_no, '[[:space:]-]+', '', 'g')) AS plate,
             array_agg(id ORDER BY created_at) AS vehicle_ids
        FROM asset.fleet_vehicles
       WHERE status <> 'decommissioned'
       GROUP BY tenant_id, upper(regexp_replace(registration_no, '[[:space:]-]+', '', 'g'))
      HAVING count(*) > 1
    LOOP
      RAISE NOTICE 'fleet_vehicles duplicate plate: tenant=% plate=% vehicles=%', dup.tenant_id, dup.plate, dup.vehicle_ids;
    END LOOP;
    RAISE NOTICE 'uq_fleet_vehicles_tenant_plate NOT created: % duplicate plate group(s) need manual resolution; re-run this migration afterwards', dup_count;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_vehicles_tenant_plate
    ON asset.fleet_vehicles (tenant_id, (upper(regexp_replace(registration_no, '[[:space:]-]+', '', 'g'))))
    WHERE status <> 'decommissioned';
END $$;
