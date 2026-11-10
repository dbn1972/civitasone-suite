-- 0167_s8_statutory_seams.sql
--
-- Section 8 / autonomous-body lane D (statutory seams). Everything here is
-- OFF / EMPTY by default: with no rows and both flags false a payroll run is
-- byte-identical to before. Statutory figures are NOT seeded here -- amounts
-- come from the existing configuration (payroll.payroll_lwf, statutory_config).
--
-- 1. payroll.payroll_statutory_seams: per-tenant flags, both DEFAULT FALSE.
--      lwf_deduction_enabled            deduct Labour Welfare Fund on the slip
--      esi_contribution_period_enabled  ESI contribution-period continuity
--    A tenant with no row is OFF.
-- 2. payroll.employee_pf_wage_basis: effective-dated per-employee EPF wage
--    basis. 'ceiling' (the default for everyone with no row) or 'actual'
--    (EPF on the actual PF wage above the ceiling). consent_ref records the
--    joint-option paperwork reference (VERIFY with counsel what is required).
-- 3. payroll.payroll_lwf_ledger: the LWF amounts actually applied per slip
--    (employee deduction and the employer share), the source for the employer
--    liability register. One row per slip.
--
-- Additive and idempotent. Rollback:
--   DROP TABLE IF EXISTS payroll.payroll_lwf_ledger, payroll.employee_pf_wage_basis, payroll.payroll_statutory_seams;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payroll.payroll_statutory_seams (
  tenant_id                       uuid        PRIMARY KEY,
  lwf_deduction_enabled           boolean     NOT NULL DEFAULT false,
  esi_contribution_period_enabled boolean     NOT NULL DEFAULT false,
  updated_by                      uuid,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll.employee_pf_wage_basis (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  employee_id    uuid        NOT NULL,
  basis          varchar(8)  NOT NULL,
  effective_from date        NOT NULL,
  consent_ref    text        NOT NULL,
  set_by         uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_pf_wage_basis_basis_chk   CHECK (basis IN ('ceiling', 'actual')),
  CONSTRAINT employee_pf_wage_basis_consent_chk CHECK (length(btrim(consent_ref)) >= 3),
  CONSTRAINT employee_pf_wage_basis_uq UNIQUE (tenant_id, employee_id, effective_from)
);
CREATE INDEX IF NOT EXISTS ix_employee_pf_wage_basis_lookup
  ON payroll.employee_pf_wage_basis (tenant_id, employee_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS payroll.payroll_lwf_ledger (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  slip_id              uuid        NOT NULL,
  run_id               uuid        NOT NULL,
  employee_id          uuid        NOT NULL,
  state_code           varchar(4)  NOT NULL,
  period               varchar(7)  NOT NULL,
  frequency            varchar(16) NOT NULL,
  employee_minor       bigint      NOT NULL DEFAULT 0,
  employer_minor       bigint      NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_lwf_ledger_amounts_chk CHECK (employee_minor >= 0 AND employer_minor >= 0),
  CONSTRAINT payroll_lwf_ledger_slip_uq UNIQUE (tenant_id, slip_id)
);
CREATE INDEX IF NOT EXISTS ix_payroll_lwf_ledger_period ON payroll.payroll_lwf_ledger (tenant_id, period, state_code);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_statutory_seams', 'employee_pf_wage_basis', 'payroll_lwf_ledger'] LOOP
    EXECUTE format('ALTER TABLE payroll.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE payroll.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON payroll.%I USING (tenant_id = payroll.current_tenant_id()) WITH CHECK (tenant_id = payroll.current_tenant_id())', t);
  END LOOP;
END $$;
