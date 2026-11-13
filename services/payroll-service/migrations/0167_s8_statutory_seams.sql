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
-- 4. payroll.payroll_s8_change_requests: maker-checker for BOTH writes above. A
--    change is a PENDING request; a DIFFERENT actor approves it (decided_by <>
--    requested_by, also a CHECK); only an approved request is applied to (1)/(2).
--    The ledger holds rows of every run that computed LWF, including runs later
--    rejected or cancelled: readers MUST join payroll_runs and use its status.
--
-- Additive and idempotent. Rollback:
--   DROP TABLE IF EXISTS payroll.payroll_s8_change_requests, payroll.payroll_lwf_ledger,
--     payroll.employee_pf_wage_basis, payroll.payroll_statutory_seams;

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
CREATE INDEX IF NOT EXISTS ix_payroll_lwf_ledger_emp ON payroll.payroll_lwf_ledger (tenant_id, employee_id, period);

CREATE TABLE IF NOT EXISTS payroll.payroll_s8_change_requests (
  id            uuid        PRIMARY KEY,
  tenant_id     uuid        NOT NULL,
  kind          varchar(16) NOT NULL,
  employee_id   uuid,
  payload       jsonb       NOT NULL,
  reason        text        NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'pending',
  requested_by  uuid        NOT NULL,
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  code          varchar(40),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_s8_change_requests_kind_chk   CHECK (kind IN ('flags', 'pf_basis')),
  CONSTRAINT payroll_s8_change_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT payroll_s8_change_requests_maker_chk  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX IF NOT EXISTS ix_payroll_s8_change_requests_tenant ON payroll.payroll_s8_change_requests (tenant_id, status, created_at);

ALTER TABLE payroll.payroll_statutory_seams ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_statutory_seams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_statutory_seams;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_statutory_seams
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

ALTER TABLE payroll.employee_pf_wage_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.employee_pf_wage_basis FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.employee_pf_wage_basis;
CREATE POLICY tenant_isolation_policy ON payroll.employee_pf_wage_basis
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

ALTER TABLE payroll.payroll_lwf_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_lwf_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_lwf_ledger;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_lwf_ledger
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

ALTER TABLE payroll.payroll_s8_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_s8_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_s8_change_requests;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_s8_change_requests
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
