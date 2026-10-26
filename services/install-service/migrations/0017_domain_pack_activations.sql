-- 0017_domain_pack_activations.sql
-- Purpose: GAP-INSTALL-DOMAIN-PACKS-01 / -04 (owner decision #28, 2026-10-26). Domain Pack activation
--   used to be fire-and-forget: install-service published citizen.pack.domain_activate and never
--   learned the outcome, so Stage 3 could not be marked completed/failed and a page reload forgot the
--   activated state. This table is the durable per-tenant activation record: created `accepted` when
--   an admin activates, moved to `completed`/`failed` by the install consumer of citizen-service's
--   citizen.pack.domain_activated event, and served by GET /v1/install/stages/3/domain-pack/status.
-- Rollback: DROP TABLE IF EXISTS install.domain_pack_activations;
-- Affected services: install-service only (the web reads it through the status endpoint).
-- Safety: new table only (no DML on an existing FORCE-RLS table); IF NOT EXISTS keeps it idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS install.domain_pack_activations (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  domain_pack_key  VARCHAR(64) NOT NULL,
  pack_keys        JSONB NOT NULL DEFAULT '[]'::jsonb,
  stage_id         UUID NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'accepted',
  draft_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_reason   TEXT,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL,
  updated_by       UUID NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT domain_pack_activations_status_check
    CHECK (status IN ('accepted', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_domain_pack_activations_tenant_pack
  ON install.domain_pack_activations (tenant_id, domain_pack_key, created_at DESC);

ALTER TABLE install.domain_pack_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE install.domain_pack_activations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON install.domain_pack_activations;
CREATE POLICY tenant_isolation ON install.domain_pack_activations
  USING (tenant_id = install.current_tenant_id())
  WITH CHECK (tenant_id = install.current_tenant_id());
