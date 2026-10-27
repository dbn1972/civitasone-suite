-- Purpose: GAP-STOCK-LEDGER-NEW-04 - store the stock-entry reason as a structured column
--          (it was only ever folded into the free-text notes), so the audit trail and
--          adjustment investigations can read it without parsing "Reason: ..." out of notes.
-- Rollback: ALTER TABLE entry.stock_entries DROP COLUMN IF EXISTS reason;
-- Affected services: stock-service

SET lock_timeout = '5s';

ALTER TABLE entry.stock_entries ADD COLUMN IF NOT EXISTS reason text;
