-- Purpose: Create contact_roles table for relationship roles on deals (CM-003).
-- Rollback: DROP TABLE IF EXISTS crm.contact_roles;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.contact_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  role varchar(32) NOT NULL CHECK (role IN ('decision_maker', 'influencer', 'champion', 'end_user', 'approver', 'technical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_roles_contact_id ON crm.contact_roles(contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_roles_deal_id ON crm.contact_roles(deal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_roles_tenant_id ON crm.contact_roles(tenant_id);

-- RLS
ALTER TABLE crm.contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.contact_roles FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'contact_roles_tenant_isolation' AND tablename = 'contact_roles'
  ) THEN
    CREATE POLICY contact_roles_tenant_isolation ON crm.contact_roles
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.contact_roles TO crm_svc;
  END IF;
END $$;
