-- Migration: 0025_gem_cppp_integration.sql
-- Purpose: SVC-050 GeM / CPPP integration. Outbound/inbound exchange references
--          for tender / order / AOC entities with reconciliation state, attempt
--          counting, and last-error tracking (env-gated adapter; no fake success).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS procurement.gem_integration_refs;
-- Affected services: procurement-service (gem module)
-- Requirements: SVC-050

BEGIN;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS procurement.gem_integration_refs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  provider        VARCHAR(8) NOT NULL DEFAULT 'gem'
                    CHECK (provider IN ('gem', 'cppp')),
  entity_type     VARCHAR(16) NOT NULL
                    CHECK (entity_type IN ('tender', 'order', 'aoc')),
  entity_id       TEXT NOT NULL,
  direction       VARCHAR(12) NOT NULL DEFAULT 'outbound'
                    CHECK (direction IN ('outbound', 'inbound')),
  external_ref    TEXT,
  external_status VARCHAR(32),
  status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'acked', 'failed', 'reconciled')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_gem_int_refs_entity ON procurement.gem_integration_refs (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_gem_int_refs_status ON procurement.gem_integration_refs (tenant_id, status);

-- RLS: fail-closed tenant isolation (indent.current_tenant_id()).
ALTER TABLE procurement.gem_integration_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.gem_integration_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON procurement.gem_integration_refs;
CREATE POLICY tenant_isolation ON procurement.gem_integration_refs
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

COMMIT;
