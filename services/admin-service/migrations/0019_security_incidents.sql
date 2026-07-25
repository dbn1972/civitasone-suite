SET lock_timeout = '5s';
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
