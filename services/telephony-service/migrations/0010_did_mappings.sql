-- Purpose: Create DID-to-tenant mapping table for inbound call routing.
-- Rollback: DROP TABLE IF EXISTS telephony.did_mappings;
-- Affected services: telephony-service (inbound webhook call routing)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS telephony.did_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  did_number VARCHAR(32) NOT NULL,
  label VARCHAR(160),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- Index for fast lookup by DID number (used during inbound call routing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_did_mappings_did_number
  ON telephony.did_mappings (did_number) WHERE active = true;

-- Index for tenant-scoped listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_did_mappings_tenant_id
  ON telephony.did_mappings (tenant_id);

-- RLS enforcement
ALTER TABLE telephony.did_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.did_mappings FORCE ROW LEVEL SECURITY;

-- Tenant isolation policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'did_mappings' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.did_mappings
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
