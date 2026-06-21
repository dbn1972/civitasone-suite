-- finance-service: add advances and utilization-certificate tables

CREATE TABLE IF NOT EXISTS payments.finance_advances (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  advance_no       text        NOT NULL,
  beneficiary      text        NOT NULL,
  type             varchar(16) NOT NULL DEFAULT 'employee',  -- employee|vendor|other
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  disbursed_date   date        NOT NULL DEFAULT CURRENT_DATE,
  due_date         date,
  adjusted_minor   bigint      NOT NULL DEFAULT 0,
  status           varchar(16) NOT NULL DEFAULT 'active',    -- active|adjusted|overdue|closed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, advance_no)
);

CREATE TABLE IF NOT EXISTS payments.finance_uc (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  uc_no            text        NOT NULL,
  grant_ref        text,
  grantee          text        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  period_from      date        NOT NULL,
  period_to        date        NOT NULL,
  submitted_date   date,
  status           varchar(16) NOT NULL DEFAULT 'pending',   -- pending|submitted|verified|rejected
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, uc_no)
);

CREATE INDEX IF NOT EXISTS idx_fadvances_tenant_status
  ON payments.finance_advances (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_fuc_tenant_status
  ON payments.finance_uc (tenant_id, status);
