-- finance-service: add free-text `purpose` to advances and utilization certificates.
-- The web create forms (POST /v1/finance/advances, POST /v1/finance/utilization-certificates)
-- capture a purpose/narration that previously had no home column. Idempotent.

ALTER TABLE payments.finance_advances ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE payments.finance_uc       ADD COLUMN IF NOT EXISTS purpose text;
