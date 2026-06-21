-- audit-service risk register module

CREATE SCHEMA IF NOT EXISTS risk;

CREATE TABLE IF NOT EXISTS risk.audit_risks (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid         NOT NULL,
  risk_code         text         NOT NULL,
  title             text         NOT NULL,
  category          varchar(24)  NOT NULL DEFAULT 'operational',
  likelihood        varchar(24)  NOT NULL DEFAULT 'possible',
  impact            varchar(24)  NOT NULL DEFAULT 'moderate',
  risk_score        integer      NOT NULL DEFAULT 0,
  owner_ref         text,
  mitigation_status varchar(24)  NOT NULL DEFAULT 'not_started',
  review_date       date,
  status            varchar(24)  NOT NULL DEFAULT 'open',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  created_by        uuid         NOT NULL,
  updated_by        uuid         NOT NULL,
  version           integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, risk_code)
);

CREATE INDEX IF NOT EXISTS idx_audit_risks_tenant ON risk.audit_risks (tenant_id, status);
