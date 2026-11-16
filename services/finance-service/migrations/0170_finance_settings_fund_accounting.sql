-- 0170_finance_settings_fund_accounting.sql
-- Section 8 nonprofit finance, slice NF-0 (docs/design/SECTION8-NONPROFIT-FINANCE.md §9, §10). Additive and idempotent.
--  gl.finance_settings.fund_accounting: per-tenant switch for fund accounting. Nullable boolean, DEFAULT false; NULL and
--  false both mean OFF. Resolved once per posting by gl/fund-context.ts. NF-0 builds only the flag and the seam -- nothing
--  reads it to change posting behaviour yet (NF-1 adds the fund master and tagging).
-- Backfill rule: every existing row keeps fund_accounting = false (the column DEFAULT is the backfill), and a tenant with no
--  settings row reads as OFF, whatever its edition. Govt behaviour is unchanged.
-- Metadata-only: ADD COLUMN with a constant default rewrites no row (PG 11+). No constraint, no index.
-- Rollback: ALTER TABLE gl.finance_settings DROP COLUMN IF EXISTS fund_accounting;
--           (only while no tenant has it true; once NF-1 tags ledger rows, turning it off is refused by design §9).

SET lock_timeout = '5s';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS fund_accounting boolean DEFAULT false;
