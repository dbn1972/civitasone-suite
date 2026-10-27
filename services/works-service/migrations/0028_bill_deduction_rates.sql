-- Purpose: owner decision D4c #37 (GAP-WORKS-BILLING-BILLS-NEW-03) — statutory deductions on a contractor bill.
--          Fixed heads (security_deposit, income_tax_tds, gst_tds, labour_cess, retention); default rates are
--          editable per executing division (a NULL division_id row is the tenant-wide default). The maker's
--          adjusted amounts live in the existing works.bill_recoveries; this migration adds the server-computed
--          amount and the rate used beside them so the checker can see what was adjusted.
-- Rollback: DROP TABLE IF EXISTS works.deduction_rates;
--           DROP INDEX IF EXISTS works.uq_bill_recoveries_bill_type;
--           ALTER TABLE works.bill_recoveries DROP COLUMN IF EXISTS rate_bps, DROP COLUMN IF EXISTS computed_amount_minor;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.deduction_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  division_id uuid,
  head varchar(32) NOT NULL,
  rate_bps integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_deduction_rates_head CHECK (head IN ('security_deposit', 'income_tax_tds', 'gst_tds', 'labour_cess', 'retention')),
  CONSTRAINT ck_deduction_rates_bps CHECK (rate_bps BETWEEN 0 AND 10000)
);

-- One row per (tenant, division-or-default, head).
CREATE UNIQUE INDEX IF NOT EXISTS uq_deduction_rates_scope_head
  ON works.deduction_rates (tenant_id, COALESCE(division_id, '00000000-0000-0000-0000-000000000000'::uuid), head);

ALTER TABLE works.bill_recoveries
  ADD COLUMN IF NOT EXISTS rate_bps integer,
  ADD COLUMN IF NOT EXISTS computed_amount_minor bigint;

-- A head appears at most once on a bill.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_recoveries_bill_type
  ON works.bill_recoveries (tenant_id, bill_id, recovery_type);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'works_svc') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON works.deduction_rates TO works_svc';
  END IF;
END $$;

ALTER TABLE works.deduction_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE works.deduction_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON works.deduction_rates;
CREATE POLICY tenant_isolation_policy ON works.deduction_rates
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
