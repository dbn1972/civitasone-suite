-- 0005: silo-tenant provisioning tracker
-- install-service records and exposes the lifecycle of provisioning a silo
-- tenant's dedicated database. The privileged DB-creation + schema migration is
-- executed by an ops/CI runner (scripts/dev/provision-silo-tenant.mjs) which
-- reports progress back here — the service itself never holds CREATE DATABASE
-- credentials.
CREATE TABLE IF NOT EXISTS install.silo_provisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  db_name      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'requested',  -- requested | provisioning | ready | failed
  steps        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{step, ok, detail, at}]
  error        TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NOT NULL,
  updated_by   UUID NOT NULL,
  version      INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_silo_status CHECK (status IN ('requested','provisioning','ready','failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_silo_provision_tenant ON install.silo_provisions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_silo_provision_status ON install.silo_provisions (status);
