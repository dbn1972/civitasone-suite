-- Migration: 0015_vehicle_passes_unique_active_plate.sql
-- Purpose: Prevent two simultaneously-active vehicle_passes rows for the
--          same tenant from sharing a registration_number (plate). Audit
--          finding: no unique constraint existed and the consumer did no
--          app-level check either, so two concurrent (or even sequential)
--          vehiclePassCreate commands for the same plate both persisted as
--          'active'. Scoped to (tenant_id, registration_number) rather than
--          registration_number alone — this is a multi-tenant table (every
--          other constraint/index/RLS policy in this schema is tenant-
--          scoped) and two different tenants' sites can legitimately have
--          same-day visitors whose plates happen to collide.
-- Depends on: 0004_material_vehicle_passes.sql (visitor.vehicle_passes)
-- Rollback: DROP INDEX IF EXISTS visitor.uq_visitor_vehicle_passes_active_plate;
-- Safety: additive, idempotent (IF NOT EXISTS). Safe to re-run. A partial
--         unique index only rejects NEW/updated rows that would violate it;
--         it does not touch existing rows. If pre-existing duplicate active
--         rows exist for a (tenant_id, registration_number) pair, this
--         migration will FAIL to create the index (Postgres refuses to
--         build a unique index over data that already violates it) — in
--         that case those duplicates must be reconciled (e.g. mark the
--         stale one 'checked_out') before re-running.

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_visitor_vehicle_passes_active_plate
  ON visitor.vehicle_passes (tenant_id, registration_number)
  WHERE status = 'active';
