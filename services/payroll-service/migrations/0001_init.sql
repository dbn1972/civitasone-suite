-- payroll-service initial migration
-- Applied with payroll_svc role on civitas_payroll.
-- L2 schemas: payroll, loans, statutory, _outbox, _inbox

CREATE SCHEMA IF NOT EXISTS payroll;
CREATE SCHEMA IF NOT EXISTS loans;
CREATE SCHEMA IF NOT EXISTS statutory;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ── payroll module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll.payroll_structures (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  name           text        NOT NULL,
  description    text,
  is_default     boolean     NOT NULL DEFAULT false,
  status         varchar(24) NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payroll.payroll_components (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  structure_id     uuid        NOT NULL,
  code             text        NOT NULL,
  name             text        NOT NULL,
  component_type   varchar(24) NOT NULL DEFAULT 'earning',
  is_taxable       boolean     NOT NULL DEFAULT false,
  formula          text,
  pct_of_basic     numeric(5,2),
  fixed_minor      bigint,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, structure_id, code)
);

CREATE TABLE IF NOT EXISTS payroll.payroll_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  run_no           text        NOT NULL,
  month            char(7)     NOT NULL,
  department_id    uuid,
  structure_id     uuid        NOT NULL,
  total_gross_minor  bigint    NOT NULL DEFAULT 0,
  total_net_minor    bigint    NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','processing','approved','disbursed','failed')),
  approved_by      uuid,
  approved_at      timestamptz,
  disbursed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, run_no)
);

CREATE TABLE IF NOT EXISTS payroll.payroll_slips (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  run_id             uuid        NOT NULL,
  employee_id        uuid        NOT NULL,
  employee_no        text        NOT NULL,
  basic_minor        bigint      NOT NULL DEFAULT 0,
  gross_minor        bigint      NOT NULL DEFAULT 0,
  total_deductions_minor bigint  NOT NULL DEFAULT 0,
  net_pay_minor      bigint      NOT NULL DEFAULT 0,
  currency           char(3)     NOT NULL DEFAULT 'INR',
  components         jsonb       NOT NULL DEFAULT '[]',
  pf_employee_minor  bigint      NOT NULL DEFAULT 0,
  pf_employer_minor  bigint      NOT NULL DEFAULT 0,
  esi_minor          bigint      NOT NULL DEFAULT 0,
  tds_minor          bigint      NOT NULL DEFAULT 0,
  status             varchar(24) NOT NULL DEFAULT 'computed',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, run_id, employee_id)
);

-- ── loans module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loans.payroll_loans (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  loan_no           text        NOT NULL,
  employee_id       uuid        NOT NULL,
  loan_type         varchar(32) NOT NULL DEFAULT 'personal',
  principal_minor   bigint      NOT NULL DEFAULT 0,
  outstanding_minor bigint      NOT NULL DEFAULT 0,
  emi_minor         bigint      NOT NULL DEFAULT 0,
  tenure_months     integer     NOT NULL DEFAULT 0,
  interest_rate_pct numeric(5,2) NOT NULL DEFAULT 0,
  currency          char(3)     NOT NULL DEFAULT 'INR',
  disbursed_at      timestamptz,
  status            varchar(24) NOT NULL DEFAULT 'applied',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, loan_no)
);

CREATE TABLE IF NOT EXISTS loans.payroll_loan_repayments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  loan_id        uuid        NOT NULL,
  run_id         uuid,
  installment_no integer     NOT NULL,
  principal_minor  bigint    NOT NULL DEFAULT 0,
  interest_minor   bigint    NOT NULL DEFAULT 0,
  total_minor      bigint    NOT NULL DEFAULT 0,
  currency         char(3)   NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'pending',
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── statutory module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS statutory.payroll_pf (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  slip_id              uuid        NOT NULL,
  employee_id          uuid        NOT NULL,
  run_id               uuid        NOT NULL,
  basic_minor          bigint      NOT NULL DEFAULT 0,
  emp_contrib_pct      numeric(5,2) NOT NULL DEFAULT 12,
  er_contrib_pct       numeric(5,2) NOT NULL DEFAULT 12,
  emp_contrib_minor    bigint      NOT NULL DEFAULT 0,
  er_contrib_minor     bigint      NOT NULL DEFAULT 0,
  currency             char(3)     NOT NULL DEFAULT 'INR',
  period               char(7)     NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_by           uuid        NOT NULL,
  version              integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, slip_id)
);

CREATE TABLE IF NOT EXISTS statutory.payroll_esi (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  slip_id          uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  run_id           uuid        NOT NULL,
  gross_minor      bigint      NOT NULL DEFAULT 0,
  emp_contrib_minor  bigint    NOT NULL DEFAULT 0,
  er_contrib_minor   bigint    NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  period           char(7)     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, slip_id)
);

CREATE TABLE IF NOT EXISTS statutory.payroll_tds (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  slip_id          uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  run_id           uuid        NOT NULL,
  annual_basic_minor bigint    NOT NULL DEFAULT 0,
  taxable_minor    bigint      NOT NULL DEFAULT 0,
  tds_minor        bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  period           char(7)     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, slip_id)
);

CREATE TABLE IF NOT EXISTS statutory.payroll_gratuity (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  employee_id      uuid        NOT NULL,
  separation_ref   text        NOT NULL,
  years_of_service numeric(5,2) NOT NULL DEFAULT 0,
  last_basic_minor bigint      NOT NULL DEFAULT 0,
  gratuity_minor   bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'computed',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_month  ON payroll.payroll_runs(tenant_id, month, status);
CREATE INDEX IF NOT EXISTS idx_payroll_slips_run          ON payroll.payroll_slips(tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_slips_employee     ON payroll.payroll_slips(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_loans_employee     ON loans.payroll_loans(tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_loan_repay         ON loans.payroll_loan_repayments(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_payroll_pf_run             ON statutory.payroll_pf(tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_tds_run            ON statutory.payroll_tds(tenant_id, run_id);

-- ── outbox ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payroll_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

-- ── inbox ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
