-- 0174_finance_vendors_udyam_category.sql
-- MSME commercial segment, slice M1 (docs/design/MSME-COMMERCIAL.md section 2). Additive and idempotent.
--  payments.finance_vendors gains udyam_category: the vendor's Udyam (MSMED Act) class, captured NOW because it cannot be
--  backfilled later and the section 43B(h) payment-deadline rule (M6) needs it. Capture only; no 43B(h) logic here.
--    udyam_category varchar(10) NULL, one of micro | small | medium | not_msme (NULL = not yet captured / unknown).
--  Nullable ADD COLUMN with no default is metadata-only on PG 11+ (no rewrite). The CHECK is added NOT VALID then VALIDATEd
--  (every existing row is NULL, so it holds) under lock_timeout. Govt tenants never set it; nothing reads it yet.
--  NOTE: budget.finance_heads.statement_class (also in the M1 design) already exists since 0169 (S4); not re-added here.
-- Rollback: ALTER TABLE payments.finance_vendors DROP CONSTRAINT IF EXISTS finance_vendors_udyam_category_valid,
--             DROP COLUMN IF EXISTS udyam_category;

SET lock_timeout = '5s';

ALTER TABLE payments.finance_vendors ADD COLUMN IF NOT EXISTS udyam_category varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_vendors_udyam_category_valid' AND conrelid = 'payments.finance_vendors'::regclass) THEN
    ALTER TABLE payments.finance_vendors ADD CONSTRAINT finance_vendors_udyam_category_valid
      CHECK (udyam_category IS NULL OR udyam_category IN ('micro', 'small', 'medium', 'not_msme')) NOT VALID;
  END IF;
END $$;

ALTER TABLE payments.finance_vendors VALIDATE CONSTRAINT finance_vendors_udyam_category_valid;
