-- Migration 0083 (fp-finance-01): office directory + sanction eFile link.
--
--   GAP-FINANCE-BUDGET-FUND-RELEASES-01   from_office_id / to_office_id on allocation
--       distributions are bare uuids with no directory, so the screen could only show
--       "Unknown office". budget.finance_offices is a minimal tenant-scoped directory
--       the distribution list joins against (names only; no FK, per the repo rule that
--       cross-entity ids stay opaque).
--   GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01 (step 6)   finance-service cannot see
--       estab-service eFiles, but it IS told when a sanction is submitted for eOffice
--       approval (submit-approval). Record that here so direct /approve can be refused
--       (409) while the file is in flight; the eOffice decision callback clears it.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS budget.finance_offices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        varchar(32) NOT NULL,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_finance_offices_tenant ON budget.finance_offices (tenant_id, name);

ALTER TABLE budget.finance_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_offices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_offices;
CREATE POLICY tenant_isolation_policy ON budget.finance_offices
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

ALTER TABLE budget.finance_sanctions ADD COLUMN IF NOT EXISTS efile_submitted_at timestamptz;
ALTER TABLE budget.finance_sanctions ADD COLUMN IF NOT EXISTS efile_file_no text;
