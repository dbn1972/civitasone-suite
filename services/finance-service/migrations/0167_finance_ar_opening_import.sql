-- 0167_finance_ar_opening_import.sql
-- AR sub-ledger opening-balance import (AR-only, maker-checker, never posts a journal).
--  1. gl.finance_change_requests.kind gains ar_opening_balance: a batch of AR sub-ledger rows that a second
--     finance_admin / super_admin approves before any row is written (POST /v1/finance/ar/opening-balances).
--  2. gl.finance_ar_ledger.source: billing_event (written by the billing consumer, today's rows) | opening_import
--     (written by the approved import). gl.finance_ar_ledger.change_request_id: the approved request that wrote it.
--  3. Lookup index on (tenant_id, demand_id): the import and the consumer both check "is there a row for this
--     billing invoice" before inserting.
-- Additive and idempotent; no existing row changes. Numbering: finance 0165 (#2509) and 0166 (#2468) are taken by
-- open PRs, so this is 0167.
-- Rollback: DROP INDEX gl.idx_finance_ar_ledger_tenant_demand; ALTER TABLE gl.finance_ar_ledger DROP COLUMN source,
-- DROP COLUMN change_request_id; restore the previous kind CHECK (only once no ar_opening_balance request exists).

SET lock_timeout = '5s';

ALTER TABLE gl.finance_change_requests DROP CONSTRAINT IF EXISTS finance_change_requests_kind_check;
ALTER TABLE gl.finance_change_requests ADD CONSTRAINT finance_change_requests_kind_check
  CHECK (kind IN ('fiscal_year_activate', 'opening_balances_enter', 'hoa_change', 'settings_relax', 'period_reopen', 'ar_opening_balance'));

ALTER TABLE gl.finance_ar_ledger ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'billing_event';
ALTER TABLE gl.finance_ar_ledger DROP CONSTRAINT IF EXISTS finance_ar_ledger_source_check;
ALTER TABLE gl.finance_ar_ledger ADD CONSTRAINT finance_ar_ledger_source_check
  CHECK (source IN ('billing_event', 'opening_import'));
ALTER TABLE gl.finance_ar_ledger ADD COLUMN IF NOT EXISTS change_request_id uuid;

CREATE INDEX IF NOT EXISTS idx_finance_ar_ledger_tenant_demand ON gl.finance_ar_ledger (tenant_id, demand_id);
