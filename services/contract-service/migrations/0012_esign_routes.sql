-- Purpose: Add e-sign routing table for sequential signature collection.
-- Rollback: DROP TABLE IF EXISTS esign.esign_routes; DROP SCHEMA IF EXISTS esign;
-- Affected services: contract-service

SET lock_timeout = '5s';

-- Create schema
CREATE SCHEMA IF NOT EXISTS esign;

-- E-sign routes table
CREATE TABLE IF NOT EXISTS esign.esign_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  signatories JSONB NOT NULL,
  current_ordinal INT NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL DEFAULT 'in_progress',
  owner_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,

  CONSTRAINT esign_routes_status_check CHECK (status IN ('in_progress', 'completed', 'cancelled'))
);

-- RLS
ALTER TABLE esign.esign_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign.esign_routes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON esign.esign_routes
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_esign_routes_tenant
  ON esign.esign_routes (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_esign_routes_contract
  ON esign.esign_routes (tenant_id, contract_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_esign_routes_status
  ON esign.esign_routes (tenant_id, status)
  WHERE status = 'in_progress';
