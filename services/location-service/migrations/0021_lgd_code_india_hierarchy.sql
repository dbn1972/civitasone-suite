-- Migration: 0021_lgd_code_india_hierarchy
-- Purpose: Add LGD (Local Government Directory) code support to locations
--          for India's administrative hierarchy (State → District → Block → Panchayat)
-- Rollback: ALTER TABLE location.locations DROP COLUMN IF EXISTS lgd_code;
--           DROP INDEX IF EXISTS location.idx_locations_lgd_code;

SET lock_timeout = '5s';

-- Add LGD code column (nullable — not all locations are LGD-coded)
ALTER TABLE location.locations ADD COLUMN IF NOT EXISTS lgd_code integer;

-- Add administrative level (state/district/block/village/panchayat)
ALTER TABLE location.locations ADD COLUMN IF NOT EXISTS admin_level text;

-- Add state_code for quick state-level filtering
ALTER TABLE location.locations ADD COLUMN IF NOT EXISTS state_code integer;

-- Index for LGD code lookup (unique per tenant)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_lgd_code_tenant
  ON location.locations (tenant_id, lgd_code) WHERE lgd_code IS NOT NULL;

-- Index for admin_level filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_admin_level
  ON location.locations (tenant_id, admin_level) WHERE admin_level IS NOT NULL;

-- Index for state_code (for district/block filtering within a state)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_state_code
  ON location.locations (tenant_id, state_code) WHERE state_code IS NOT NULL;

COMMENT ON COLUMN location.locations.lgd_code IS 'Official LGD (Local Government Directory) numeric code from lgdirectory.gov.in';
COMMENT ON COLUMN location.locations.admin_level IS 'Administrative level: state, district, sub_district, block, village, panchayat, municipality';
COMMENT ON COLUMN location.locations.state_code IS 'LGD state code for quick hierarchical filtering';
