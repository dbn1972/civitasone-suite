-- 0062_tax_declaration_lifecycle.sql
--
-- fin-payroll-02 (finish wave). Additive + idempotent.
--
-- GAP-PAYROLL-TAX-DECLARATION-02: landlord name + PAN for HRA claims where the
--   annual rent exceeds Rs 1,00,000 (Form 12BB / CBDT circular on HRA proofs).
--   landlord_pan is PII: stored as ciphertext (app-level pii-crypto, same as
--   statutory.payroll_tds_nonsalary.deductee_pan), hence TEXT not varchar(10).
-- GAP-PAYROLL-TAX-DECLARATION-05: "last updated" on a declaration (created_at
--   never changes on resubmission) and a per-tenant, per-FY submission window.
--   After closes_on an employee can no longer submit; payroll staff can still
--   file on their behalf. NOTHING seeded: no window row => always open
--   (today's behaviour).
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll.tax_declaration_windows;
--   ALTER TABLE payroll.payroll_tax_declarations DROP COLUMN IF EXISTS landlord_name,
--     DROP COLUMN IF EXISTS landlord_pan, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_tax_declarations
  ADD COLUMN IF NOT EXISTS landlord_name varchar(128),
  ADD COLUMN IF NOT EXISTS landlord_pan  text,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by    uuid;

CREATE TABLE IF NOT EXISTS payroll.tax_declaration_windows (
  tenant_id     uuid        NOT NULL,
  fy            char(7)     NOT NULL,
  opens_on      date,
  closes_on     date        NOT NULL,
  change_reason text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        NOT NULL,
  PRIMARY KEY (tenant_id, fy)
);

DO $$ BEGIN
  ALTER TABLE payroll.tax_declaration_windows ADD CONSTRAINT tax_declaration_windows_order_chk
    CHECK (opens_on IS NULL OR opens_on <= closes_on);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE payroll.tax_declaration_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.tax_declaration_windows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.tax_declaration_windows;
CREATE POLICY tenant_isolation_policy ON payroll.tax_declaration_windows
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
