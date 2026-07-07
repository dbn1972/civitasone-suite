-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: theme-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- theme.tokens.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_created_by
  ON theme.tokens (created_by);

-- theme.tokens.updated_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_updated_by
  ON theme.tokens (updated_by);

-- theme.brand_config.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brand_config_created_by
  ON theme.brand_config (created_by);

-- theme.brand_config.updated_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brand_config_updated_by
  ON theme.brand_config (updated_by);

-- theme.revisions.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revisions_created_by
  ON theme.revisions (created_by);

-- theme.revisions.updated_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revisions_updated_by
  ON theme.revisions (updated_by);

-- branding.tenant_branding.created_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_branding_created_by
  ON branding.tenant_branding (created_by);

-- branding.tenant_branding.updated_by (FK-style lookup column — user audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_branding_updated_by
  ON branding.tenant_branding (updated_by);
