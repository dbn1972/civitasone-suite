-- finance-service initial migration
-- Applied with finance_svc role on civitas_finance.
-- Schemas budget, gl, treasury, payments, _outbox, _inbox are pre-created by DB bootstrap.
-- This migration creates all tables, indexes, outbox, and inbox.

-- Create audit schema (not part of DB bootstrap for this service)
CREATE SCHEMA IF NOT EXISTS audit;

-- ── budget module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget.finance_heads (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  code             text        NOT NULL,            -- LMMHA code
  name             text        NOT NULL,
  level            int         NOT NULL,            -- 0=major 1=minor 2=sub
  classification   text,                            -- revenue|capital|plan|nonplan
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS budget.finance_budgets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  head_id          uuid        NOT NULL,
  fy               char(7)     NOT NULL,            -- 2024-25
  be_minor         bigint      NOT NULL DEFAULT 0,
  re_minor         bigint      NOT NULL DEFAULT 0,
  allocated_minor  bigint      NOT NULL DEFAULT 0,
  utilised_minor   bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, head_id, fy)
);

CREATE TABLE IF NOT EXISTS budget.finance_demands (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  demand_no        text        NOT NULL,
  service          text        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  class            text        NOT NULL DEFAULT 'voted',   -- voted|charged
  status           varchar(24) NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, demand_no)
);

CREATE TABLE IF NOT EXISTS budget.finance_schemes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  code             text        NOT NULL,
  name             text        NOT NULL,
  outlay_minor     bigint      NOT NULL DEFAULT 0,
  utilised_minor   bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  funding          text,                            -- css|state|central
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS budget.finance_sanctions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  sanction_no      text        NOT NULL,
  purpose          text        NOT NULL,
  head_id          uuid        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'draft',   -- draft|approved|exhausted|cancelled
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, sanction_no)
);

-- ── gl module ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gl.finance_journals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  voucher_no       text        NOT NULL,
  type             varchar(32) NOT NULL,            -- journal|payment|receipt|contra
  posting_date     date        NOT NULL,
  lines            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status           varchar(24) NOT NULL DEFAULT 'draft',   -- draft|posted|reversed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, voucher_no)
);

CREATE TABLE IF NOT EXISTS gl.finance_ledger (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  head_id          uuid        NOT NULL,
  debit_minor      bigint      NOT NULL DEFAULT 0,
  credit_minor     bigint      NOT NULL DEFAULT 0,
  balance_minor    bigint      NOT NULL DEFAULT 0,
  voucher_no       text        NOT NULL,
  posting_date     date        NOT NULL,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── treasury module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS treasury.finance_banks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  account_no       text        NOT NULL,
  balance_minor    bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  reconciled       boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, account_no)
);

CREATE TABLE IF NOT EXISTS treasury.finance_challans (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  challan_no       text        NOT NULL,
  receipt_head_id  uuid        NOT NULL,
  depositor        text        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  grn_no           text,
  status           varchar(24) NOT NULL DEFAULT 'pending',  -- pending|deposited|reconciled
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, challan_no)
);

CREATE TABLE IF NOT EXISTS treasury.finance_deposits (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  pd_no            text        NOT NULL,
  type             varchar(32) NOT NULL,            -- pd|emd|sd|fdr
  administrator    text        NOT NULL,
  balance_minor    bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, pd_no)
);

CREATE TABLE IF NOT EXISTS treasury.finance_debt (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  instrument       text        NOT NULL,            -- bond|loan|overdraft
  source           text        NOT NULL,            -- RBI|market|central_govt
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  maturity         date,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS treasury.finance_guarantees (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  entity           text        NOT NULL,
  type             varchar(32) NOT NULL,            -- bg|pbg|performance|advance
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  fee_pct          numeric(5,4) NOT NULL DEFAULT 0,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── payments module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments.finance_bills (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  bill_no          text        NOT NULL,
  vendor_id        uuid        NOT NULL,
  head_id          uuid        NOT NULL,
  sanction_ref     uuid,
  gross_minor      bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  deductions       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  net_minor        bigint      NOT NULL DEFAULT 0,
  po_ref           text,                            -- opaque "procurement_po:UUID"
  grn_ref          text,
  stage            varchar(32) NOT NULL DEFAULT 'section',  -- section|accounts|pay
  status           varchar(24) NOT NULL DEFAULT 'pending',  -- pending|passed|rejected|paid
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, bill_no)
);

CREATE TABLE IF NOT EXISTS payments.finance_payments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  eft_ref          text,
  bill_id          uuid        NOT NULL,
  mode             varchar(16) NOT NULL CHECK (mode IN ('NEFT','RTGS','IMPS','DBT','PFMS','cheque')),
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  utr              text,
  status           varchar(24) NOT NULL DEFAULT 'initiated',  -- initiated|processed|failed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments.finance_pfms (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  pfms_id          text        NOT NULL,
  type             varchar(32) NOT NULL,            -- grant|scheme|salary
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  beneficiary_count int        NOT NULL DEFAULT 0,
  status           varchar(24) NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, pfms_id)
);

-- ── audit module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit.finance_audit_paras (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  para_no            text        NOT NULL,
  source             varchar(32) NOT NULL,          -- CAG|AG|internal
  dept               text        NOT NULL,
  money_value_minor  bigint      NOT NULL DEFAULT 0,
  currency           char(3)     NOT NULL DEFAULT 'INR',
  status             varchar(24) NOT NULL DEFAULT 'open',   -- open|replied|settled|dropped
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, para_no)
);

-- ── indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fheads_tenant        ON budget.finance_heads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fbudgets_tenant_fy   ON budget.finance_budgets(tenant_id, fy);
CREATE INDEX IF NOT EXISTS idx_fsanctions_tenant     ON budget.finance_sanctions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fjournals_tenant_date ON gl.finance_journals(tenant_id, posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_fledger_head_date     ON gl.finance_ledger(tenant_id, head_id, posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_fbills_tenant_status  ON payments.finance_bills(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fpayments_bill        ON payments.finance_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_fchallans_tenant      ON treasury.finance_challans(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fauditparas_tenant    ON audit.finance_audit_paras(tenant_id, status);

-- ── outbox (write-path durability) ───────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

-- ── inbox (consumer idempotency) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
