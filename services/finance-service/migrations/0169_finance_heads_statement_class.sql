-- 0169_finance_heads_statement_class.sql
-- Tenant-type profile switch (docs/design/TENANT-PROFILE-SWITCH.md), slice S4. Additive and idempotent.
--  budget.finance_heads.statement_class: the STORED financial-statement class of a head. Schedule III (commercial) and the
--  Section 8 / PSU statements classify from this column, never from the code prefix (the same code means different things
--  in different templates). NULL for every govt head and every pre-existing head -- the govt seed does not set it, so
--  existing tenants' rows and every govt-reachable query are untouched.
--  Domain (a superset, so MSME / Section 8 / PSU need no further migration): asset, current_liability,
--  non_current_liability, equity, reserve, income, expense, and the PSU values govt_equity, capital_reserve,
--  dividend_payable. NULL is allowed (the CHECK passes on NULL).
-- Metadata-only: a nullable ADD COLUMN with no default rewrites no row. The CHECK is added NOT VALID then VALIDATEd (every
-- existing row is NULL, so validation is instant) under a short lock_timeout.
-- Rollback: ALTER TABLE budget.finance_heads DROP CONSTRAINT IF EXISTS finance_heads_statement_class_check;
--           ALTER TABLE budget.finance_heads DROP COLUMN IF EXISTS statement_class;
--           (only while no non-govt tenant relies on it).

SET lock_timeout = '5s';

ALTER TABLE budget.finance_heads ADD COLUMN IF NOT EXISTS statement_class varchar(32);

ALTER TABLE budget.finance_heads DROP CONSTRAINT IF EXISTS finance_heads_statement_class_check;
ALTER TABLE budget.finance_heads ADD CONSTRAINT finance_heads_statement_class_check
  CHECK (statement_class IS NULL OR statement_class IN (
    'asset', 'current_liability', 'non_current_liability', 'equity', 'reserve', 'income', 'expense',
    'govt_equity', 'capital_reserve', 'dividend_payable'
  )) NOT VALID;
ALTER TABLE budget.finance_heads VALIDATE CONSTRAINT finance_heads_statement_class_check;
