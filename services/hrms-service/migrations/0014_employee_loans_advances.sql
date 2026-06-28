-- hrms-service: Employee Loans & Salary Advances — live CRUD.
-- Additive, idempotent.

-- Loan master (HBA, Motor Car, Computer, Festival, etc.)
CREATE TABLE IF NOT EXISTS employee.hrms_loans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  employee_id      uuid NOT NULL,
  loan_type        varchar(32) NOT NULL,  -- hba|motor_car|computer|festival|personal|other
  sanctioned_amount_minor bigint NOT NULL DEFAULT 0,
  disbursed_amount_minor  bigint NOT NULL DEFAULT 0,
  outstanding_minor       bigint NOT NULL DEFAULT 0,
  interest_rate_bps       integer NOT NULL DEFAULT 0,  -- basis points (e.g. 750 = 7.5%)
  emi_minor               bigint NOT NULL DEFAULT 0,
  total_emis              integer NOT NULL DEFAULT 0,
  emis_paid               integer NOT NULL DEFAULT 0,
  sanction_date    date NOT NULL,
  first_emi_date   date,
  last_emi_date    date,
  purpose          text,
  status           varchar(16) NOT NULL DEFAULT 'active',  -- pending|active|completed|cancelled
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

-- Salary advance requests
CREATE TABLE IF NOT EXISTS employee.hrms_salary_advances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  employee_id      uuid NOT NULL,
  amount_minor     bigint NOT NULL DEFAULT 0,
  purpose          varchar(200) NOT NULL,
  recovery_months  integer NOT NULL DEFAULT 1,
  emi_minor        bigint NOT NULL DEFAULT 0,
  recovered_minor  bigint NOT NULL DEFAULT 0,
  request_date     date NOT NULL DEFAULT CURRENT_DATE,
  approved_by      uuid,
  status           varchar(16) NOT NULL DEFAULT 'pending',  -- pending|approved|active|completed|rejected
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_loans_tenant_emp ON employee.hrms_loans(tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_advances_tenant_emp ON employee.hrms_salary_advances(tenant_id, employee_id, status);
