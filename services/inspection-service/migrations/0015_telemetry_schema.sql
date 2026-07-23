-- Purpose: Create Telemetry / IoT schema and tables (SVC-110)
-- Rollback: DROP TABLE IF EXISTS telemetry.alert_rules;
--           DROP TABLE IF EXISTS telemetry.telemetry_alerts;
--           DROP TABLE IF EXISTS telemetry.telemetry_readings;
--           DROP TABLE IF EXISTS telemetry.devices;
--           DROP SCHEMA IF EXISTS telemetry;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS telemetry;

CREATE TABLE IF NOT EXISTS telemetry.devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  device_type       varchar(24) NOT NULL
                    CHECK (device_type IN ('sensor', 'drone', 'camera', 'iot_gateway')),
  device_identifier text NOT NULL,
  name              text NOT NULL,
  entity_id         uuid,
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  status            varchar(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'maintenance')),
  last_seen_at      timestamptz,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS telemetry.telemetry_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  device_id    uuid NOT NULL,
  reading_type varchar(64) NOT NULL,
  value        numeric(18,6) NOT NULL,
  unit         varchar(24) NOT NULL,
  latitude     numeric(10,7),
  longitude    numeric(10,7),
  captured_at  timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS telemetry.telemetry_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  device_id       uuid NOT NULL,
  reading_id      uuid,
  alert_type      varchar(24) NOT NULL
                  CHECK (alert_type IN ('threshold_exceeded', 'anomaly', 'offline')),
  severity        varchar(16) NOT NULL
                  CHECK (severity IN ('critical', 'major', 'minor')),
  threshold_value numeric(18,6),
  actual_value    numeric(18,6),
  status          varchar(24) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'acknowledged', 'resolved', 'finding_created')),
  finding_id      uuid,
  resolved_at     timestamptz,
  resolved_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS telemetry.alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  device_type     varchar(24) NOT NULL,
  reading_type    varchar(64) NOT NULL,
  operator        varchar(4) NOT NULL
                  CHECK (operator IN ('gt', 'lt', 'gte', 'lte', 'eq')),
  threshold_value numeric(18,6) NOT NULL,
  severity        varchar(16) NOT NULL
                  CHECK (severity IN ('critical', 'major', 'minor')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_devices_tenant
  ON telemetry.devices (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_devices_entity
  ON telemetry.devices (tenant_id, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_devices_status
  ON telemetry.devices (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_readings_device
  ON telemetry.telemetry_readings (tenant_id, device_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_readings_captured
  ON telemetry.telemetry_readings (tenant_id, captured_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_alerts_tenant
  ON telemetry.telemetry_alerts (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_alerts_status
  ON telemetry.telemetry_alerts (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_alerts_device
  ON telemetry.telemetry_alerts (tenant_id, device_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_alert_rules_tenant
  ON telemetry.alert_rules (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_alert_rules_active
  ON telemetry.alert_rules (tenant_id, is_active);
