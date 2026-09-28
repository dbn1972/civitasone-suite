-- Migration: 0029_water_tanker_tables.sql
-- Purpose: facade-closure for asset-service's water-tanker module.
--   water-tanker/routes.ts publishes commands (asset.water_tanker.booking.*)
--   but no consumer.ts was ever registered in worker.ts, and no migration
--   ever created a `water_tanker` schema or any table in it (confirmed by
--   grepping every migration file) -- so POST returns 202
--   {id,status:"accepted"} but nothing is ever persisted, and GET list/by-id
--   either 500s ("relation ... does not exist") or comes back silently
--   empty despite the "accepted" write.
-- This migration creates the `water_tanker` schema and its one table
-- exactly matching the pre-existing src/modules/water-tanker/schema.ts
-- Drizzle definition, plus RLS (FORCE + tenant_isolation_policy via
-- register.current_tenant_id(), the shared cross-schema GUC accessor -- see
-- 0007/0009/0016/0018/0026/0027/0028) and the standard audit columns.
-- Affected service: asset-service
-- Rollback: DROP TABLE IF EXISTS water_tanker.asset_water_tanker_bookings;
--           DROP SCHEMA IF EXISTS water_tanker;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS water_tanker;

CREATE TABLE IF NOT EXISTS water_tanker.asset_water_tanker_bookings (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  booking_number         text        NOT NULL,
  requested_by           uuid        NOT NULL,
  delivery_address       jsonb,
  ward                   varchar(64),
  tanker_capacity_litres integer     NOT NULL,
  requested_date         date        NOT NULL,
  requested_slot         varchar(16),
  status                 varchar(16) NOT NULL DEFAULT 'requested',
  scheduled_date         date,
  tanker_vehicle_id      text,
  driver_id              uuid,
  dispatched_at          timestamptz,
  delivered_at           timestamptz,
  fee_minor              bigint      NOT NULL DEFAULT 0,
  currency               char(3)     NOT NULL DEFAULT 'INR',
  fee_paid               boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        NOT NULL,
  updated_by             uuid        NOT NULL,
  version                integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_water_tanker_bookings_tenant ON water_tanker.asset_water_tanker_bookings (tenant_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE water_tanker.asset_water_tanker_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_tanker.asset_water_tanker_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON water_tanker.asset_water_tanker_bookings;
CREATE POLICY tenant_isolation_policy ON water_tanker.asset_water_tanker_bookings
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
