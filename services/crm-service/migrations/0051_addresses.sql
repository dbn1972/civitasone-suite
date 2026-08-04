-- Purpose: CM-001 multiple addresses per contact/account. crm.addresses holds
--   typed postal addresses (billing/shipping/registered/office/home/other) with a
--   single primary per owner. Tenant-scoped, FORCE RLS.
-- Rollback: DROP TABLE IF EXISTS crm.addresses;
-- Affected services: crm-service (addresses module)
-- Sequencing: additive — new tenant-scoped table, no FKs, no backfill.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_type varchar(8) NOT NULL CHECK (owner_type IN ('contact', 'account')),
  owner_id uuid NOT NULL,
  address_type varchar(12) NOT NULL
    CHECK (address_type IN ('billing', 'shipping', 'registered', 'office', 'home', 'other')),
  line1 text NOT NULL,
  line2 text,
  city varchar(100),
  state varchar(100),
  pincode varchar(12),
  country varchar(2) NOT NULL DEFAULT 'IN',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_tenant ON crm.addresses(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_owner
  ON crm.addresses(tenant_id, owner_type, owner_id);
-- At most one primary per owner. Partial unique index enforces it at the DB even
-- if two writers race; the consumer also demotes the previous primary on write.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_addresses_one_primary
  ON crm.addresses(tenant_id, owner_type, owner_id) WHERE is_primary = true;

ALTER TABLE crm.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.addresses FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'addresses_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'addresses'
  ) THEN
    CREATE POLICY addresses_tenant_isolation ON crm.addresses
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.addresses TO crm_svc;
  END IF;
END $g$;
