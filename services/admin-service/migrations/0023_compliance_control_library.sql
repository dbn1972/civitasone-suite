-- Migration: 0023_compliance_control_library.sql
-- CAP-089 — Real compliance control library + evidence (replaces the hardcoded
-- SOC2 control theatre). Also back-fills RLS + grants for the pre-existing
-- admin.vapt_scans / admin.security_incidents tables (which had no schema/RLS
-- until migration 0022 created the admin schema).
-- Additive + idempotent. Rollback: DROP TABLE admin.control_evidence, admin.compliance_controls;
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS admin;

-- Back-fill the pre-existing security-compliance tables (migration 0019 was a
-- dead no-op — it ran before the admin schema existed, so these were never
-- created and every read/write threw at runtime).
CREATE TABLE IF NOT EXISTS admin.vapt_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  target_services jsonb NOT NULL, scan_type varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued', findings_count int NOT NULL DEFAULT 0,
  critical int NOT NULL DEFAULT 0, high int NOT NULL DEFAULT 0,
  medium int NOT NULL DEFAULT 0, low int NOT NULL DEFAULT 0,
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vapt_scans_tenant ON admin.vapt_scans (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  title varchar(256) NOT NULL, severity varchar(16) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'open', description text,
  affected_services jsonb NOT NULL DEFAULT '[]',
  detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  reported_to_cert timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_incidents_tenant ON admin.security_incidents (tenant_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS admin.compliance_controls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  control_key   varchar(32) NOT NULL,          -- e.g. CC6.1, A.9.2.1, DPDP-7
  framework     varchar(16) NOT NULL,          -- SOC2 | ISO27001 | DPDP
  title         varchar(256) NOT NULL,
  description   text,
  owner         varchar(128),
  status        varchar(16) NOT NULL DEFAULT 'not_tested', -- pass | fail | not_tested | not_applicable
  last_tested_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT compliance_controls_framework_chk CHECK (framework IN ('SOC2','ISO27001','DPDP')),
  CONSTRAINT compliance_controls_status_chk CHECK (status IN ('pass','fail','not_tested','not_applicable'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_controls_key ON admin.compliance_controls (tenant_id, framework, control_key);
CREATE INDEX IF NOT EXISTS idx_compliance_controls_tenant ON admin.compliance_controls (tenant_id, framework);

CREATE TABLE IF NOT EXISTS admin.control_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  control_id   uuid NOT NULL,
  kind         varchar(24) NOT NULL,           -- audit_event | document | vapt_report | note
  reference    varchar(512),                   -- URL / audit event id / document id
  note         text,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  CONSTRAINT control_evidence_kind_chk CHECK (kind IN ('audit_event','document','vapt_report','note'))
);
CREATE INDEX IF NOT EXISTS idx_control_evidence_control ON admin.control_evidence (tenant_id, control_id, collected_at DESC);

GRANT USAGE ON SCHEMA admin TO admin_svc;
GRANT ALL ON ALL TABLES IN SCHEMA admin TO admin_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA admin TO admin_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT ALL ON TABLES TO admin_svc;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin.compliance_controls','admin.control_evidence','admin.vapt_scans','admin.security_incidents'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
