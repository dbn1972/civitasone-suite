-- Migration: 0049_reconciliation_engine.sql
-- Purpose: CAP-059 — persist reconciliation runs + exceptions ("breaks") so the
--          generic @civitasone/reconciliation engine has a real host. A run
--          pulls two independent sources (e.g. book payments vs bank statement
--          lines), the engine compares them, and every mismatch is persisted as
--          a break with an open→investigating→resolved/written_off lifecycle.
-- Rollback: DROP TABLE IF EXISTS recon.recon_break; DROP TABLE IF EXISTS recon.recon_run;
-- Service:  finance-service (recon module) — DB civitas_finance, role finance_svc.
-- Notes:    Additive + idempotent. Money deltas are BIGINT paise. FORCE RLS.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS recon AUTHORIZATION finance_svc;

CREATE OR REPLACE FUNCTION recon.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ── recon_run: one reconciliation execution ─────────────────────────────────
CREATE TABLE IF NOT EXISTS recon.recon_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  provider      VARCHAR(64) NOT NULL,
  source_system TEXT NOT NULL,
  target_system TEXT NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('running','completed','failed')),
  source_count  INTEGER NOT NULL DEFAULT 0,
  target_count  INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  break_count   INTEGER NOT NULL DEFAULT 0,
  balanced      BOOLEAN NOT NULL DEFAULT false,
  params        JSONB,
  note          TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  triggered_by  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recon_run_tenant_created
  ON recon.recon_run (tenant_id, created_at DESC);

ALTER TABLE recon.recon_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon.recon_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recon.recon_run;
CREATE POLICY tenant_isolation_policy ON recon.recon_run
  USING (tenant_id = recon.current_tenant_id())
  WITH CHECK (tenant_id = recon.current_tenant_id());

-- ── recon_break: one exception with a resolution lifecycle ──────────────────
CREATE TABLE IF NOT EXISTS recon.recon_break (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  run_id          UUID NOT NULL,
  break_key       TEXT NOT NULL,
  break_type      VARCHAR(24) NOT NULL
                    CHECK (break_type IN ('missing_in_target','missing_in_source','value_mismatch','duplicate_key')),
  field           TEXT,
  field_type      VARCHAR(16),
  source_value    TEXT,
  target_value    TEXT,
  delta_minor     BIGINT,
  severity        VARCHAR(8) NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high')),
  status          VARCHAR(16) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','investigating','resolved','written_off')),
  resolution_note TEXT,
  resolved_by     UUID,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_recon_break_tenant_status
  ON recon.recon_break (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_recon_break_run
  ON recon.recon_break (tenant_id, run_id);

ALTER TABLE recon.recon_break ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon.recon_break FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recon.recon_break;
CREATE POLICY tenant_isolation_policy ON recon.recon_break
  USING (tenant_id = recon.current_tenant_id())
  WITH CHECK (tenant_id = recon.current_tenant_id());
