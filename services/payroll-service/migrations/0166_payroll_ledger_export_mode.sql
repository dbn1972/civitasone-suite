-- 0166_payroll_ledger_export_mode.sql
--
-- M9 (module-sale gap): payroll for a tenant WITHOUT the Finance module.
--
-- 1. payroll.payroll_settings.ledger_mode_override: NULL (the default, and the
--    value of every existing tenant) means the mode is derived from whether the
--    tenant has Finance ("finance" if it does, "export" if not). 'finance' or
--    'export' forces it. Additive and nullable: no existing row changes meaning.
-- 2. payroll.payroll_journal_exports: the salary journals an export-mode tenant
--    downloads (CSV / Tally) instead of finance-service posting them. One row
--    per run per stage ('accrual' written on approval, 'disbursement' on
--    disbursement); lines is the exact set of journal lines, paise as digit
--    strings. Written by the run approve / disburse consumers in the same
--    transaction as the status change, so a retry can never produce a second
--    journal (UNIQUE tenant, run, stage).
--
-- Idempotent: safe to run twice.
-- Rollback:
--   DROP TABLE IF EXISTS payroll.payroll_journal_exports;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS ledger_mode_override;
SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS ledger_mode_override varchar(8);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_settings_ledger_mode_chk') THEN
    ALTER TABLE payroll.payroll_settings
      ADD CONSTRAINT payroll_settings_ledger_mode_chk
      CHECK (ledger_mode_override IS NULL OR ledger_mode_override IN ('finance', 'export'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll.payroll_journal_exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  run_id       uuid NOT NULL,
  stage        varchar(16) NOT NULL,
  voucher_no   varchar(64) NOT NULL,
  posting_date date NOT NULL,
  month        varchar(7) NOT NULL,
  lines        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  CONSTRAINT payroll_journal_exports_stage_chk CHECK (stage IN ('accrual', 'disbursement'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_journal_exports_run_stage
  ON payroll.payroll_journal_exports (tenant_id, run_id, stage);

ALTER TABLE payroll.payroll_journal_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_journal_exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_journal_exports;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_journal_exports
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.payroll_journal_exports TO payroll_svc;
  END IF;
END $$;
