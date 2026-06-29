-- 0004: tenant isolation tier registry (tiered multi-tenancy)
-- isolation_tier drives connection routing: 'pool' (shared per-service DB,
-- tenant_id + RLS) or 'silo' (the tenant's own dedicated DB hosting all
-- service schemas). db_dsn_ref / kms_key_ref are SECRET REFERENCES (names in a
-- secrets manager), never plaintext DSNs/keys.
ALTER TABLE tenant.tenants
  ADD COLUMN IF NOT EXISTS isolation_tier VARCHAR(8) NOT NULL DEFAULT 'pool',
  ADD COLUMN IF NOT EXISTS db_dsn_ref     TEXT,
  ADD COLUMN IF NOT EXISTS kms_key_ref    TEXT;

ALTER TABLE tenant.tenants
  ADD CONSTRAINT chk_isolation_tier CHECK (isolation_tier IN ('pool', 'silo'));

CREATE INDEX IF NOT EXISTS idx_tenants_isolation ON tenant.tenants (isolation_tier);
