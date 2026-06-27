-- 0016_schema_integrity.sql
-- Purpose: Add missing structural columns (PKs, version, audit columns) to
--          tables introduced in 0014_multi_ddo_pensioner.sql and
--          0012_p1_challan_taxcfg_perq_26q.sql, and add a performance index
--          needed by the duplicate-run guard query.
--
-- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS for idempotency.
-- The sentinel UUID '00000000-0000-0000-0000-000000000000' is used as the
-- DEFAULT for NOT NULL audit columns so existing rows get a valid placeholder
-- without requiring a data migration.
--
-- Additive + idempotent only — no DROP TABLE, no data changes.

-- ─────────────────────────────────────────────────────────────────
-- 1. payroll.payroll_ddos
--    Original PK was (tenant_id, ddo_code). Add a surrogate UUID PK column
--    and standard audit/version columns.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE payroll.payroll_ddos
  ADD COLUMN IF NOT EXISTS id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS version    integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

-- Promote the new id column to a unique index (cannot change the composite PK
-- without a full table rewrite, but a unique index on id serves the same purpose
-- for FK references and API identity).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_ddos_id
  ON payroll.payroll_ddos (id);

-- ─────────────────────────────────────────────────────────────────
-- 2. payroll.payroll_ddo_departments
--    Original PK was (tenant_id, department_id). Add surrogate id and version.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE payroll.payroll_ddo_departments
  ADD COLUMN IF NOT EXISTS id      uuid    NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_ddo_departments_id
  ON payroll.payroll_ddo_departments (id);

-- ─────────────────────────────────────────────────────────────────
-- 3. payroll.payroll_pensioners
--    Already has a proper UUID PK and audit columns; only version was missing.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE payroll.payroll_pensioners
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- ─────────────────────────────────────────────────────────────────
-- 4. statutory.payroll_tds_nonsalary
--    Add version, updated_at, and updated_by (created_at/created_by exist).
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE statutory.payroll_tds_nonsalary
  ADD COLUMN IF NOT EXISTS version    integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

-- ─────────────────────────────────────────────────────────────────
-- 5. Performance index for duplicate-run guard query
--    The dup-run guard filters payroll_runs by (tenant_id, run_type, month).
--    The existing idx_payroll_runs_tenant_month covers (tenant_id, month, status)
--    but not run_type; a query plan that must filter on run_type performs a
--    sequential scan on larger tenants.
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payroll_runs_type
  ON payroll.payroll_runs (tenant_id, run_type, month);
