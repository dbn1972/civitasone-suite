-- Migration: 0008_devices_print_jobs.sql
-- Purpose: Hardware integration tables for the kiosk-hardware-integration feature.
--          Adds 9 tables: devices, device_audit_log, device_configs, badge_templates,
--          print_jobs, scan_sessions, ocr_results, passage_events, device_commands.
--          Also extends visitor.gates with an optional device_id FK.
--
-- Depends on: 0001_locations_areas_gates_parking.sql (visitor.locations, visitor.gates)
--             0002_visit_requests_digital_passes.sql (visitor.digital_passes)
--
-- Rollback steps (manual):
--   ALTER TABLE visitor.gates DROP COLUMN IF EXISTS device_id;
--   DROP TABLE IF EXISTS visitor.device_commands;
--   DROP TABLE IF EXISTS visitor.passage_events;
--   DROP TABLE IF EXISTS visitor.ocr_results;
--   DROP TABLE IF EXISTS visitor.scan_sessions;
--   DROP TABLE IF EXISTS visitor.print_jobs;
--   DROP TABLE IF EXISTS visitor.badge_templates;
--   DROP TABLE IF EXISTS visitor.device_configs;
--   DROP TABLE IF EXISTS visitor.device_audit_log;
--   DROP TABLE IF EXISTS visitor.devices;
--
-- Affected services: visitor-service only (hardware integration modules:
--   device-registry, badge-print, document-scan, turnstile-control)
--
-- Safety: additive, idempotent (IF NOT EXISTS throughout). Safe to re-run.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. visitor.devices — device registry
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.devices (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid         NOT NULL,
  device_type              varchar(16)  NOT NULL CHECK (device_type IN ('kiosk', 'printer', 'scanner', 'turnstile', 'barrier')),
  name                     varchar(128) NOT NULL,
  serial_number            varchar(64)  NOT NULL,
  location_id              uuid         NOT NULL REFERENCES visitor.locations(id),
  gate_id                  uuid         REFERENCES visitor.gates(id),
  status                   varchar(24)  NOT NULL DEFAULT 'pending_activation'
                                        CHECK (status IN ('pending_activation', 'active', 'suspended', 'deregistered')),
  auth_type                varchar(16)  NOT NULL CHECK (auth_type IN ('bearer_token', 'mtls')),
  device_token_hash        text,
  certificate_fingerprint  varchar(128),
  capabilities             jsonb        NOT NULL DEFAULT '{}',
  firmware_version         varchar(32),
  firmware_status          varchar(16)  DEFAULT 'current'
                                        CHECK (firmware_status IN ('current', 'outdated', 'critical')),
  last_seen_at             timestamptz,
  online                   boolean      NOT NULL DEFAULT false,
  pending_config           jsonb,
  config_version           integer      NOT NULL DEFAULT 0,
  config_push_attempts     integer      NOT NULL DEFAULT 0,
  token_expires_at         timestamptz,
  token_rotated_at         timestamptz,
  old_token_hash           text,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  created_by               uuid         NOT NULL,
  updated_by               uuid         NOT NULL,
  version                  integer      NOT NULL DEFAULT 1
);

ALTER TABLE visitor.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.devices;
CREATE POLICY tenant_isolation_policy ON visitor.devices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_tenant_serial
  ON visitor.devices (tenant_id, serial_number);

CREATE INDEX IF NOT EXISTS idx_devices_tenant_location
  ON visitor.devices (tenant_id, location_id);

CREATE INDEX IF NOT EXISTS idx_devices_tenant_status
  ON visitor.devices (tenant_id, status);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. visitor.device_audit_log — lifecycle events
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.device_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  device_id   uuid        NOT NULL REFERENCES visitor.devices(id),
  action      varchar(32) NOT NULL
              CHECK (action IN ('registered', 'activated', 'deregistered', 'credential_rotated', 'config_updated', 'suspended', 'firmware_flagged')),
  details     jsonb,
  actor_id    uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.device_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.device_audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.device_audit_log;
CREATE POLICY tenant_isolation_policy ON visitor.device_audit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_device_audit_log_device
  ON visitor.device_audit_log (device_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. visitor.device_configs — configuration versions
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.device_configs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  device_id        uuid        NOT NULL REFERENCES visitor.devices(id),
  config_version   integer     NOT NULL,
  config_payload   jsonb       NOT NULL,
  delivery_status  varchar(20) NOT NULL DEFAULT 'pending'
                               CHECK (delivery_status IN ('pending', 'delivered', 'acknowledged', 'delivery_failed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL
);

ALTER TABLE visitor.device_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.device_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.device_configs;
CREATE POLICY tenant_isolation_policy ON visitor.device_configs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_device_configs_device_version
  ON visitor.device_configs (device_id, config_version DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. visitor.badge_templates — label templates
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.badge_templates (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  name                varchar(128) NOT NULL,
  printer_language    varchar(8)   NOT NULL CHECK (printer_language IN ('zpl', 'escpos')),
  template_body       text         NOT NULL,
  badge_width_mm      integer      NOT NULL DEFAULT 54,
  badge_height_mm     integer      NOT NULL DEFAULT 86,
  status              varchar(12)  NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'archived')),
  visitor_category    varchar(16)  NOT NULL DEFAULT 'default'
                                   CHECK (visitor_category IN ('default', 'walk_in', 'pre_registered', 'vip', 'contractor', 'group')),
  template_version    integer      NOT NULL DEFAULT 1,
  previous_version_id uuid         REFERENCES visitor.badge_templates(id),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_by          uuid         NOT NULL,
  updated_by          uuid         NOT NULL,
  version             integer      NOT NULL DEFAULT 1
);

ALTER TABLE visitor.badge_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.badge_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.badge_templates;
CREATE POLICY tenant_isolation_policy ON visitor.badge_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_badge_templates_tenant_category
  ON visitor.badge_templates (tenant_id, visitor_category, printer_language);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. visitor.print_jobs — print queue
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.print_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  device_id         uuid        NOT NULL REFERENCES visitor.devices(id),
  pass_id           uuid        NOT NULL REFERENCES visitor.digital_passes(id),
  template_id       uuid        NOT NULL REFERENCES visitor.badge_templates(id),
  status            varchar(16) NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued', 'in_progress', 'completed', 'failed')),
  priority          varchar(12) NOT NULL DEFAULT 'standard'
                                CHECK (priority IN ('standard', 'high')),
  rendered_payload  text,
  retry_count       integer     NOT NULL DEFAULT 0,
  next_retry_at     timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.print_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.print_jobs;
CREATE POLICY tenant_isolation_policy ON visitor.print_jobs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_print_jobs_device_status
  ON visitor.print_jobs (device_id, status);

CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status
  ON visitor.print_jobs (tenant_id, status, created_at);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. visitor.scan_sessions — OCR sessions
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.scan_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  device_id          uuid        NOT NULL REFERENCES visitor.devices(id),
  status             varchar(16) NOT NULL DEFAULT 'uploading'
                                 CHECK (status IN ('uploading', 'processing', 'completed', 'failed')),
  image_storage_key  text,
  image_deleted      boolean     NOT NULL DEFAULT false,
  image_expires_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.scan_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.scan_sessions;
CREATE POLICY tenant_isolation_policy ON visitor.scan_sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. visitor.ocr_results — extracted data (PII columns encrypted at app level)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.ocr_results (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  scan_session_id      uuid        NOT NULL REFERENCES visitor.scan_sessions(id),
  full_name            text,                              -- PII: encrypted at app layer (encryptedText)
  date_of_birth        text,                              -- PII: encrypted at app layer
  id_document_number   text,                              -- PII: encrypted at app layer
  id_document_type     varchar(24) CHECK (id_document_type IN ('aadhaar', 'pan', 'driving_license', 'voter_id')),
  address              text,                              -- PII: encrypted at app layer
  photo_region_key     text,
  confidence_scores    jsonb,
  low_confidence       boolean     NOT NULL DEFAULT false,
  blacklist_match      boolean     NOT NULL DEFAULT false,
  watchlist_match      boolean     NOT NULL DEFAULT false,
  verification_status  varchar(16) DEFAULT 'pending'
                                   CHECK (verification_status IN ('pending', 'verified', 'failed', 'unavailable')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.ocr_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.ocr_results;
CREATE POLICY tenant_isolation_policy ON visitor.ocr_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. visitor.passage_events — gate passages
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.passage_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  device_id         uuid        NOT NULL REFERENCES visitor.devices(id),
  gate_id           uuid        NOT NULL REFERENCES visitor.gates(id),
  pass_id           uuid        NOT NULL REFERENCES visitor.digital_passes(id),
  direction         varchar(4)  NOT NULL CHECK (direction IN ('in', 'out')),
  event_type        varchar(16) NOT NULL DEFAULT 'passage'
                                CHECK (event_type IN ('passage', 'abandoned', 'tailgating')),
  passage_count     integer     NOT NULL DEFAULT 1,
  offline_recorded  boolean     NOT NULL DEFAULT false,
  event_timestamp   timestamptz NOT NULL,
  synced_at         timestamptz,
  sync_status       varchar(24) NOT NULL DEFAULT 'realtime'
                                CHECK (sync_status IN ('realtime', 'offline_synced', 'retroactively_invalid')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.passage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.passage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.passage_events;
CREATE POLICY tenant_isolation_policy ON visitor.passage_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_passage_events_pass_direction
  ON visitor.passage_events (pass_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_passage_events_device_time
  ON visitor.passage_events (device_id, event_timestamp DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. visitor.device_commands — command queue
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visitor.device_commands (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  device_id       uuid        NOT NULL REFERENCES visitor.devices(id),
  command_type    varchar(20) NOT NULL CHECK (command_type IN ('open', 'close', 'emergency_open', 'config_push')),
  payload         jsonb,
  status          varchar(16) NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'delivered', 'acknowledged', 'expired')),
  correlation_id  uuid,
  expires_at      timestamptz,
  delivered_at    timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.device_commands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.device_commands;
CREATE POLICY tenant_isolation_policy ON visitor.device_commands
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_device_commands_device_status
  ON visitor.device_commands (device_id, status);

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. Extend visitor.gates — optional device binding
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE visitor.gates ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES visitor.devices(id);
