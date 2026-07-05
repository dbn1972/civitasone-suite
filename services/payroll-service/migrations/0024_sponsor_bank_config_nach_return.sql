-- 0024: Sponsor bank configuration for NACH/APBS file generation + return records
--
-- Purpose:
--   Adds per-tenant NACH sponsor bank configuration (debit account, IFSC, utility code, etc.)
--   and a table to store parsed NACH return file records for reconciliation.
--
-- Rollback steps:
--   DROP INDEX IF EXISTS payroll.idx_nach_return_run;
--   DROP TABLE IF EXISTS payroll.nach_return_records;
--   DROP TABLE IF EXISTS payroll.sponsor_bank_config;
--
-- Affected services: payroll-service
-- Additive + idempotent (IF NOT EXISTS).

SET lock_timeout = '5s';

-- ── Sponsor bank configuration (one per tenant) ─────────────────────────────
CREATE TABLE IF NOT EXISTS payroll.sponsor_bank_config (
  tenant_id                   uuid PRIMARY KEY,
  sponsor_code                varchar(4) NOT NULL,
  sponsor_ifsc                varchar(11) NOT NULL,
  sponsor_account             text NOT NULL,
  utility_code                varchar(18),
  user_number                 varchar(20),
  settlement_offset_days      integer NOT NULL DEFAULT 1,
  nach_enabled                boolean NOT NULL DEFAULT true,
  apbs_enabled                boolean NOT NULL DEFAULT false,
  max_records_per_file        integer NOT NULL DEFAULT 100000,
  max_amount_per_file_minor   bigint NOT NULL DEFAULT 1000000000,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,
  updated_by                  uuid NOT NULL
);

-- ── NACH return reconciliation records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll.nach_return_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  run_id            uuid NOT NULL,
  slip_id           uuid,
  employee_no       varchar(32) NOT NULL,
  status_code       varchar(2) NOT NULL,
  reason_code       varchar(4),
  reason_text       text,
  amount_minor      bigint NOT NULL,
  processed_at      timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nach_return_run
  ON payroll.nach_return_records(tenant_id, run_id);
