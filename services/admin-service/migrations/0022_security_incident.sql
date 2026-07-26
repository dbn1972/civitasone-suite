-- Migration: 0022_security_incident.sql
-- CAP-090 — Security incident & breach management (DPDP §8(6)).
-- Also creates the `admin` schema (previously missing — migration 0019 was a
-- dead no-op because no migration ever ran CREATE SCHEMA admin) and back-fills
-- RLS + grants for the pre-existing admin.vapt_scans / admin.security_incidents
-- tables so the security-compliance module actually works at runtime.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP SCHEMA admin CASCADE;
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS admin;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── incidents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin.sec_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  title             varchar(256) NOT NULL,
  severity          varchar(16) NOT NULL,
  category          varchar(48) NOT NULL DEFAULT 'other',
  status            varchar(16) NOT NULL DEFAULT 'detected',
  description       text,
  affected_assets   jsonb NOT NULL DEFAULT '[]',
  affected_tenants  jsonb NOT NULL DEFAULT '[]',
  is_breach         boolean NOT NULL DEFAULT false,
  affected_data_principals integer NOT NULL DEFAULT 0,
  root_cause        text,
  resolution        text,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  triaged_at        timestamptz,
  contained_at      timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  reported_by       uuid NOT NULL,
  closed_by         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT sec_incidents_severity_chk CHECK (severity IN ('critical','high','medium','low')),
  CONSTRAINT sec_incidents_status_chk CHECK (status IN ('detected','triaged','contained','resolved','closed'))
);
CREATE INDEX IF NOT EXISTS idx_sec_incidents_tenant ON admin.sec_incidents (tenant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_incidents_status ON admin.sec_incidents (tenant_id, status);

-- ── immutable timeline ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin.sec_incident_timeline (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  incident_id  uuid NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid NOT NULL,
  from_status  varchar(16),
  to_status    varchar(16),
  note         text
);
CREATE INDEX IF NOT EXISTS idx_sec_timeline_incident ON admin.sec_incident_timeline (tenant_id, incident_id, at);

-- ── breach notifications (DPDP §8(6)) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS admin.sec_breach_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  incident_id   uuid NOT NULL,
  authority     varchar(24) NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'pending',
  window_hours  integer NOT NULL DEFAULT 72,
  deadline_at   timestamptz NOT NULL,
  affected_count integer NOT NULL DEFAULT 0,
  reference     varchar(128),
  submitted_at  timestamptz,
  acknowledged_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  CONSTRAINT sec_breach_authority_chk CHECK (authority IN ('data_protection_board','data_principals')),
  CONSTRAINT sec_breach_status_chk CHECK (status IN ('pending','submitted','acknowledged'))
);
CREATE INDEX IF NOT EXISTS idx_sec_breach_incident ON admin.sec_breach_notifications (tenant_id, incident_id);
CREATE INDEX IF NOT EXISTS idx_sec_breach_deadline ON admin.sec_breach_notifications (tenant_id, status, deadline_at);

-- ── grants ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA admin TO admin_svc;
GRANT ALL ON ALL TABLES IN SCHEMA admin TO admin_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA admin TO admin_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT ALL ON TABLES TO admin_svc;

-- ── RLS: tenant isolation, forced (owner civitas_admin is also forced) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin.sec_incidents','admin.sec_incident_timeline','admin.sec_breach_notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
