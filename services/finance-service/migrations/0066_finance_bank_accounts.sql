-- Migration 0066: Bank Account master (payments.finance_bank_accounts)
--
-- BUG FIX: masters/bank-routes.ts (GET/POST /v1/finance/bank-accounts) has
-- referenced payments.finance_bank_accounts since it was written, but no
-- migration ever created the table (confirmed via pg_tables) — every call
-- 500s. Follows the same masters-table conventions as
-- payments.finance_vendors (0065_vendor_master.sql) / payments.finance_pao /
-- payments.finance_ddo: tenant-scoped, soft-active `status`, version + a
-- single `created_by` audit column (matching exactly what the drizzle table
-- definition inline in masters/bank-routes.ts declares — no updated_at /
-- updated_by, since that file's schema doesn't declare them either). The RLS
-- policy is the full ENABLE + FORCE + USING/WITH CHECK pattern from
-- 0035_rls_full_tenant_isolation.sql, applied in the same migration that
-- creates the table (as 0065 did) rather than as a follow-up.
--
-- account_no / ifsc are `text` (not varchar) and hold ciphertext
-- (encryptedText in masters/bank-routes.ts) — same helper and same reasoning
-- as finance_vendors.bank_account_no/ifsc: real payment-routing data, no
-- reason to hold it to a lower bar than vendor bank details. No format CHECK
-- on either column since a CHECK can't see past ciphertext; format is
-- validated at the Zod layer (createBankBody) on cleartext before encryption.
--
-- account_type gets a CHECK mirroring createBankBody's Zod enum
-- (savings|current|overdraft) — defense-in-depth, same convention as
-- chk_vendor_pan / chk_pao_code / chk_ddo_code elsewhere in this directory.
-- status is NOT constrained the same way: only "active" is ever written by
-- current code (no status-transition route exists yet), so a CHECK here
-- would be guessing at an incomplete vocabulary — left open rather than
-- risk blocking a legitimate future value.
--
-- Deliberately NOT added here: a foreign key from
-- payments.finance_payments.bank_account_id to this table's id. Same
-- reasoning as 0065's vendor_master note — this table has never existed
-- until now, so any existing finance_payments.bank_account_id value is by
-- definition unbacked; a retroactive FK could fail to apply or silently mask
-- orphans if added NOT VALID. Left as a noted follow-up once/if a backfill
-- reconciliation is done.

CREATE TABLE IF NOT EXISTS payments.finance_bank_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  bank_name    varchar(200) NOT NULL,
  branch_name  varchar(200),
  account_no   text NOT NULL,
  ifsc         text NOT NULL,
  account_type varchar(20) NOT NULL DEFAULT 'current',
  purpose      varchar(64),
  status       varchar(12) NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_bank_account_type CHECK (account_type IN ('savings', 'current', 'overdraft'))
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant ON payments.finance_bank_accounts(tenant_id);

ALTER TABLE payments.finance_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_bank_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_bank_accounts;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_bank_accounts;
CREATE POLICY tenant_isolation_policy ON payments.finance_bank_accounts
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
