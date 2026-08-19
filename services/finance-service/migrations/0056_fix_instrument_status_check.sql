-- DB-B2: Drop the older, narrower CHECK that does not include 'stale'.
-- finance_instruments_status_check (which includes 'stale') now governs alone.
DO $$ BEGIN
  ALTER TABLE treasury.finance_instruments DROP CONSTRAINT chk_finance_instruments_status;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
