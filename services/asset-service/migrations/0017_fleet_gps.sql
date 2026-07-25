SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS asset.fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  registration_no varchar(20) NOT NULL, make varchar(64), model varchar(64),
  year int, fuel_type varchar(16), assigned_driver_id uuid,
  current_lat numeric(10,7), current_lng numeric(10,7), last_gps_at timestamptz,
  fuel_level_pct int, odometer_km int, status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_tenant ON asset.fleet_vehicles (tenant_id);
CREATE TABLE IF NOT EXISTS asset.fleet_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES asset.fleet_vehicles(id),
  start_lat numeric(10,7), start_lng numeric(10,7), end_lat numeric(10,7), end_lng numeric(10,7),
  distance_km numeric(8,2), started_at timestamptz NOT NULL, ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset.fleet_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES asset.fleet_vehicles(id),
  type varchar(32) NOT NULL, scheduled_date date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'scheduled', cost_minor bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
