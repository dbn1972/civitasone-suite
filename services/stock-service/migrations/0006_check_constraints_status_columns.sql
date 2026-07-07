-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: stock-service

SET lock_timeout = '5s';

-- ============================================================================
-- entry.stock_entries.status
-- Valid states: draft, submitted, approved, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE entry.stock_entries
    ADD CONSTRAINT stock_entries_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- entry.stock_entries.entry_type
-- Valid values: receipt, issue, transfer, adjustment
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE entry.stock_entries
    ADD CONSTRAINT stock_entries_entry_type_check
    CHECK (entry_type IN ('receipt', 'issue', 'transfer', 'adjustment'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- eway_bill.eway_bills.status
-- Valid states: pending, generated, cancelled, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE eway_bill.eway_bills
    ADD CONSTRAINT eway_bills_status_check
    CHECK (status IN ('pending', 'generated', 'cancelled', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE entry.stock_entries VALIDATE CONSTRAINT stock_entries_status_check;
ALTER TABLE entry.stock_entries VALIDATE CONSTRAINT stock_entries_entry_type_check;
ALTER TABLE eway_bill.eway_bills VALIDATE CONSTRAINT eway_bills_status_check;
