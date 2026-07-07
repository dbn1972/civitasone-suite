-- Migration: Add ITIL ticket types and CMDB asset linkage columns.
-- Rollback: ALTER TABLE helpdesk.tickets DROP COLUMN IF EXISTS ticket_type,
--           DROP COLUMN IF EXISTS type_fields,
--           DROP COLUMN IF EXISTS asset_ids,
--           DROP COLUMN IF EXISTS asset_verified;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

-- ITIL ticket type (incident, problem, change) — nullable for backward compat with legacy tickets.
ALTER TABLE helpdesk.tickets ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(24);

-- Type-specific required fields stored as JSONB.
ALTER TABLE helpdesk.tickets ADD COLUMN IF NOT EXISTS type_fields JSONB;

-- CMDB: array of asset IDs from asset-service.
ALTER TABLE helpdesk.tickets ADD COLUMN IF NOT EXISTS asset_ids JSONB;

-- CMDB: whether the asset linkage has been verified against asset-service.
ALTER TABLE helpdesk.tickets ADD COLUMN IF NOT EXISTS asset_verified BOOLEAN DEFAULT false;

-- CHECK constraint: ticket_type must be one of the ITIL types or NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_tickets_ticket_type'
  ) THEN
    ALTER TABLE helpdesk.tickets
      ADD CONSTRAINT chk_tickets_ticket_type
      CHECK (ticket_type IS NULL OR ticket_type IN ('incident', 'problem', 'change'));
  END IF;
END $$;

-- Index for filtering by ticket_type (common query pattern for ITIL views).
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_type
  ON helpdesk.tickets (tenant_id, ticket_type)
  WHERE ticket_type IS NOT NULL;
