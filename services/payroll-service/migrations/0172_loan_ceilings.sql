-- 0172_loan_ceilings.sql
-- GAP-PAYROLL-LOANS-06 (owner decision 2026-11-26): "Max eligible" is NOT hard-coded. Per-tenant, per-loan-type
-- principal ceilings are DATA that Finance supplies. NO ROWS = NO CEILING (today's behaviour is unchanged) --
-- the owner must have Finance populate this table (PUT /v1/payroll/loan-ceilings) before any ceiling applies.
-- Additive and idempotent. No seed rows on purpose: no ceiling value has been supplied by Finance.
-- Rollback: DROP TABLE IF EXISTS loans.loan_ceilings;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS loans.loan_ceilings (
  tenant_id           uuid        NOT NULL,
  loan_type           varchar(32) NOT NULL,
  max_principal_minor bigint      NOT NULL,
  change_reason       text        NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid        NOT NULL,
  PRIMARY KEY (tenant_id, loan_type)
);

DO $$ BEGIN
  ALTER TABLE loans.loan_ceilings ADD CONSTRAINT loan_ceilings_max_positive_chk CHECK (max_principal_minor > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE loans.loan_ceilings ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans.loan_ceilings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON loans.loan_ceilings;
CREATE POLICY tenant_isolation_policy ON loans.loan_ceilings
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
