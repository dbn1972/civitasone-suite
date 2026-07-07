-- Migration: 0015_cause_list_syncs
-- Purpose: Create ecourts schema and cause_list_syncs table for tracking e-Courts sync state per matter.
-- Rollback: DROP TABLE IF EXISTS ecourts.cause_list_syncs; DROP SCHEMA IF EXISTS ecourts;
-- Affected services: legal-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS ecourts;

CREATE TABLE IF NOT EXISTS ecourts.cause_list_syncs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  case_id              UUID NOT NULL,
  cnr_number           TEXT NOT NULL,
  last_sync_at         TIMESTAMPTZ,
  last_sync_status     TEXT NOT NULL DEFAULT 'pending',
  last_error           TEXT,
  next_hearing_date    TEXT,
  next_hearing_purpose TEXT,
  orders_downloaded    INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID NOT NULL,
  updated_by           UUID NOT NULL,
  version              INT NOT NULL DEFAULT 1
);

-- Unique constraint: one sync record per case per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_cause_list_syncs_tenant_case
  ON ecourts.cause_list_syncs (tenant_id, case_id);

-- Index for efficient lookups by CNR number
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cause_list_syncs_cnr
  ON ecourts.cause_list_syncs (cnr_number);

-- RLS enforcement
ALTER TABLE ecourts.cause_list_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecourts.cause_list_syncs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ecourts.cause_list_syncs
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
