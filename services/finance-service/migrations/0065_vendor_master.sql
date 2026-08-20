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
-- bank_account_no/ifsc ARE encrypted at rest (encryptedText, same helper
-- masters/bank-routes.ts's finance_bank_accounts uses) — real government
-- vendor payment-routing details, no reason to hold them to a lower bar
-- than the org's own accounts. This is safe for these two columns
-- specifically because neither carries a uniqueness constraint (unlike
-- pan below, where a random-IV scheme would silently break
-- UNIQUE(tenant_id, pan) — see masters/schema.ts). Columns are `text`
-- (not varchar) because ciphertext is longer than the cleartext value;
-- format is validated at the Zod layer on cleartext before encryption,
-- not via a DB CHECK, since a CHECK can't see past the ciphertext.

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
  bank_account_no  text NOT NULL,
  ifsc             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1,
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vendor_pan   CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT chk_vendor_gstin CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
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
