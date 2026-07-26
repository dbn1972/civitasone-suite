-- Migration: 0002_metadata_extensions.sql
-- Purpose: Make metadata-service a real runnable service.
--          (1) transactional outbox/inbox (worker + audit enqueue),
--          (2) maker-checker publish columns on entity_definitions,
--          (3) named formula definitions (calculation engine),
--          (4) module composition definitions (low-code composer).
-- Rollback: DROP TABLE metadata.formula_definitions, metadata.module_compositions;
--           ALTER TABLE metadata.entity_definitions DROP COLUMN published_at, DROP COLUMN published_by;
--           DROP SCHEMA _outbox CASCADE; DROP SCHEMA _inbox CASCADE;
-- Safety: additive, idempotent (IF NOT EXISTS throughout).

SET lock_timeout = '5s';

-- ── Transactional outbox / inbox ──────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid NOT NULL,
  actor_id       uuid NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ── Maker-checker publish state on entity definitions ─────────────────────────
ALTER TABLE metadata.entity_definitions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE metadata.entity_definitions ADD COLUMN IF NOT EXISTS published_by UUID;

-- ── Formula Definitions (named, reusable calculation formulas) ────────────────
CREATE TABLE IF NOT EXISTS metadata.formula_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  api_name VARCHAR(128) NOT NULL,          -- e.g. "line_total", "grade_average"
  label VARCHAR(256) NOT NULL,
  expression TEXT NOT NULL,                -- safe arithmetic expression: "qty * unit_price * (1 - discount)"
  return_type VARCHAR(16) NOT NULL DEFAULT 'number',  -- number | string | boolean
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  UNIQUE (tenant_id, api_name)
);

ALTER TABLE metadata.formula_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.formula_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.formula_definitions;
CREATE POLICY tenant_isolation ON metadata.formula_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Module Compositions (low-code assembly of entity + layout + workflow refs) ─
CREATE TABLE IF NOT EXISTS metadata.module_compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  api_name VARCHAR(128) NOT NULL,
  label VARCHAR(256) NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}',  -- { entities:[apiName], layouts:[{entity,layoutId}], workflows:[key], navigation:[...] }
  status VARCHAR(16) NOT NULL DEFAULT 'draft',  -- draft | published
  published_at TIMESTAMPTZ,
  published_by UUID,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  UNIQUE (tenant_id, api_name)
);

ALTER TABLE metadata.module_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.module_compositions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.module_compositions;
CREATE POLICY tenant_isolation ON metadata.module_compositions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
