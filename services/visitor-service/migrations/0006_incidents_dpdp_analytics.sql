-- Migration: 0006_incidents_dpdp_analytics.sql
-- Purpose: Security incident log, DPDP compliance audit tables, and analytics
--          pre-computed metrics for visitor-service (visitor.security_incidents,
--          visitor.consent_log, visitor.pii_access_log, visitor.daily_metrics)
--          per the design's Drizzle schema (modules/evacuation/schema.ts
--          securityIncidents, DPDP compliance tables consentLog/piiAccessLog,
--          analytics dailyMetrics)
-- Depends on: 0001_locations_areas_gates_parking.sql (visitor.locations)
-- Rollback: DROP TABLE IF EXISTS visitor.daily_metrics; DROP TABLE IF EXISTS visitor.pii_access_log;
--           DROP TABLE IF EXISTS visitor.consent_log; DROP TABLE IF EXISTS visitor.security_incidents;
--           (all four are leaf tables — no other table FKs to them)
-- Safety: additive, idempotent (IF NOT EXISTS throughout). Safe to re-run.
-- Note: consent_log and pii_access_log are append-only audit tables (no updated_at/version,
--       no application-level UPDATE/DELETE) but still carry tenant_isolation RLS per the
--       design's "RLS enabled on all tables" requirement.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- ── security_incidents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.security_incidents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  location_id         uuid        NOT NULL REFERENCES visitor.locations(id),
  incident_type       varchar(32) NOT NULL CHECK (incident_type IN (
                        'blacklist_match', 'watchlist_alert', 'material_discrepancy',
                        'unauthorized_zone', 'overstay', 'face_match_fail', 'forced_entry'
                      )),
  related_pass_id     uuid,
  related_visitor_id  uuid,
  description         text        NOT NULL,
  severity            varchar(8)  NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  resolved_at         timestamptz,
  resolved_by         uuid,
  resolution          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL
);

ALTER TABLE visitor.security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.security_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.security_incidents;
DROP POLICY IF EXISTS tenant_isolation ON visitor.security_incidents;
CREATE POLICY tenant_isolation_policy ON visitor.security_incidents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_security_incidents_tenant_created_at
  ON visitor.security_incidents (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_visitor_security_incidents_tenant_location
  ON visitor.security_incidents (tenant_id, location_id);

-- ── consent_log ──────────────────────────────────────────────────────────────
-- Append-only DPDP consent record. visitor_ref is a non-PII reference (e.g. a
-- tracking ref or internal ID) — no encrypted PII is stored in this table.
CREATE TABLE IF NOT EXISTS visitor.consent_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  visitor_ref     varchar(64) NOT NULL,
  purpose         text        NOT NULL,
  data_collected  jsonb       NOT NULL DEFAULT '[]',
  retention_days  integer     NOT NULL DEFAULT 365,
  consented_at    timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.consent_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.consent_log;
DROP POLICY IF EXISTS tenant_isolation ON visitor.consent_log;
CREATE POLICY tenant_isolation_policy ON visitor.consent_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_consent_log_tenant_visitor_ref
  ON visitor.consent_log (tenant_id, visitor_ref);

-- ── pii_access_log ───────────────────────────────────────────────────────────
-- Append-only DPDP access log: every PII read is recorded with the accessor's
-- identity, timestamp, and stated purpose (per design's "Access Logging" row).
CREATE TABLE IF NOT EXISTS visitor.pii_access_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  accessor_id   uuid        NOT NULL,
  resource_type varchar(32) NOT NULL,
  resource_id   uuid        NOT NULL,
  purpose       varchar(64) NOT NULL,
  accessed_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.pii_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.pii_access_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.pii_access_log;
DROP POLICY IF EXISTS tenant_isolation ON visitor.pii_access_log;
CREATE POLICY tenant_isolation_policy ON visitor.pii_access_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_pii_access_log_tenant_resource
  ON visitor.pii_access_log (tenant_id, resource_type, resource_id);

-- ── daily_metrics ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.daily_metrics (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  location_id           uuid        NOT NULL REFERENCES visitor.locations(id),
  date                  timestamptz NOT NULL,
  total_visits          integer     NOT NULL DEFAULT 0,
  unique_visitors       integer     NOT NULL DEFAULT 0,
  avg_approval_time_ms  integer,
  avg_visit_duration_ms integer,
  peak_hour             integer     CHECK (peak_hour IS NULL OR (peak_hour >= 0 AND peak_hour <= 23)),
  no_show_count         integer     NOT NULL DEFAULT 0,
  rejected_count        integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE visitor.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.daily_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.daily_metrics;
DROP POLICY IF EXISTS tenant_isolation ON visitor.daily_metrics;
CREATE POLICY tenant_isolation_policy ON visitor.daily_metrics
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_daily_metrics_tenant_location_date
  ON visitor.daily_metrics (tenant_id, location_id, date);
