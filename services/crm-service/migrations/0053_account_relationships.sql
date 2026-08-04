-- Purpose: CM-002 account relationships / groups. Beyond the single accounts.parent_id
--   hierarchy (migration 0020), crm.account_relationships lets an account carry
--   typed links to other accounts (parent/subsidiary/group/branch/partner/affiliate)
--   so groups, branches and partner networks are representable. Tenant-scoped, FORCE RLS.
-- Rollback: DROP TABLE IF EXISTS crm.account_relationships;
-- Affected services: crm-service (accounts module). The parent/child hierarchy is untouched.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.account_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  from_account_id uuid NOT NULL,
  to_account_id uuid NOT NULL,
  rel_type varchar(12) NOT NULL
    CHECK (rel_type IN ('parent', 'subsidiary', 'group', 'branch', 'partner', 'affiliate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  -- A self-loop is never a relationship.
  CONSTRAINT account_relationships_no_self CHECK (from_account_id <> to_account_id)
);

-- One directed edge of a given type between two accounts.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_account_relationships_edge
  ON crm.account_relationships(tenant_id, from_account_id, to_account_id, rel_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_relationships_from
  ON crm.account_relationships(tenant_id, from_account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_relationships_to
  ON crm.account_relationships(tenant_id, to_account_id);

ALTER TABLE crm.account_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.account_relationships FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'account_relationships_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'account_relationships'
  ) THEN
    CREATE POLICY account_relationships_tenant_isolation ON crm.account_relationships
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.account_relationships TO crm_svc;
  END IF;
END $g$;
