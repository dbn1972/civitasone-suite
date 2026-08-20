-- Migration 0065: Vendor master (payments.finance_vendors)
--
-- Backs the vendor-master frontend (apps/web finance/vendors list + [id]
-- detail pages), which has been calling a listVendors() stub that returns
-- []. Follows the same masters-table conventions as payments.finance_pao /
-- payments.finance_ddo (0010_hoa_pao_voucher.sql): tenant-scoped, soft-active
-- flag, business-code-style unique constraint with a format CHECK. Unlike
-- finance_ddo's version/created_by/updated_by (added later, retroactively,
-- by 0043_schema_drift_fixups.sql), those audit/version columns are baked
-- into this table from creation. The RLS policy is the full
-- ENABLE + FORCE + USING/WITH CHECK pattern from
-- 0035_rls_full_tenant_isolation.sql (payments.finance_pao/finance_ddo),
-- applied here in the same migration that creates the table rather than as
-- a follow-up — this table should never have a window where RLS is absent.
--
-- Deliberately NOT added here: a foreign key from payments.finance_bills /
-- payments.finance_payments .vendor_id to this table's id. Those columns
-- have existed with no backing vendor table until now, so historical rows
-- may hold vendor_id values with no corresponding vendor row once this table
-- exists. A retroactive FK could fail to apply outright, or (if added
-- NOT VALID) silently mask orphaned references. Left as a noted follow-up
-- for once vendor backfill/reconciliation against existing bill/payment
-- vendor_id values has been done.
--
-- Also deliberately NOT done here: encrypting bank_account_no/ifsc the way
-- masters/bank-routes.ts's finance_bank_accounts (the org's own treasury
-- accounts) encrypts them via encryptedText. This table's pan column carries
-- a UNIQUE(tenant_id, pan) constraint, which a random-IV encryption scheme
-- would silently break (two rows with the same real PAN would get different
-- ciphertext and the constraint would never fire) — see masters/schema.ts
-- for the same note. Vendor bank_account_no/ifsc are plaintext for now;
-- worth revisiting alongside the encryptedText helper if vendor bank details
-- need the same at-rest protection as the org's own accounts.

CREATE TABLE IF NOT EXISTS payments.finance_vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  name             text NOT NULL,
  category         text NOT NULL,
  pan              varchar(10) NOT NULL,
  gstin            varchar(15),
  address          text NOT NULL,
  contact_person   text,
  phone            varchar(20),
  email            text,
  bank_name        text NOT NULL,
  bank_account_no  varchar(30) NOT NULL,
  ifsc             varchar(11) NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1,
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vendor_pan   CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT chk_vendor_gstin CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CONSTRAINT chk_vendor_ifsc  CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  UNIQUE (tenant_id, pan)
);
CREATE INDEX IF NOT EXISTS idx_vendor_tenant ON payments.finance_vendors(tenant_id);

ALTER TABLE payments.finance_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_vendors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_vendors;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_vendors;
CREATE POLICY tenant_isolation_policy ON payments.finance_vendors
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
