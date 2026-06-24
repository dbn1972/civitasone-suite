-- 0016_pension.sql
-- P-Pension: CCS Pension / DCRG / Commutation / Family Pension records.
-- Additive + idempotent only.

CREATE SCHEMA IF NOT EXISTS pension;

CREATE TABLE IF NOT EXISTS pension.hrms_pension_records (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  employee_id               uuid NOT NULL,
  pension_scheme            varchar(8) NOT NULL,
  retirement_date           date NOT NULL,
  date_of_joining           date NOT NULL,
  -- inputs (snapshot, paise)
  last_basic_minor          bigint NOT NULL DEFAULT 0,
  da_rate_pct               numeric(6,2) NOT NULL DEFAULT 0,
  avg_emoluments_minor      bigint NOT NULL DEFAULT 0,
  -- qualifying service
  qualifying_half_years     integer NOT NULL DEFAULT 0,
  qualifying_years          numeric(6,2) NOT NULL DEFAULT 0,
  -- computed (paise)
  monthly_pension_minor     bigint NOT NULL DEFAULT 0,
  commuted_pct              numeric(6,2) NOT NULL DEFAULT 0,
  commuted_value_minor      bigint NOT NULL DEFAULT 0,
  residual_pension_minor    bigint NOT NULL DEFAULT 0,
  dcrg_minor                bigint NOT NULL DEFAULT 0,
  family_pension_normal_minor   bigint NOT NULL DEFAULT 0,
  family_pension_enhanced_minor bigint NOT NULL DEFAULT 0,
  breakdown                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency                  char(3) NOT NULL DEFAULT 'INR',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  version                   integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hrms_pension_records_emp
  ON pension.hrms_pension_records (tenant_id, employee_id);
