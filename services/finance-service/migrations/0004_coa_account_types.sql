-- Fix P1-FIN-005: Add liability, income, and expense accounts to Chart of Accounts.
-- Without these, Balance Sheet and P&L cannot be produced.
-- Also correct any seed data where re_minor > be_minor (GFR Rule 11 violation).

-- Seed demo accounts for the default tenant (00000000-0000-0000-0000-000000000001)
INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_by, updated_by)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '3001', 'Capital Account',         0, 'liability', '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '3002', 'Grants-in-Aid Capital',   1, 'liability', '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '4001', 'Revenue Receipts',        0, 'income',    '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '4002', 'Tax Revenue',             1, 'income',    '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '6001', 'Establishment Expenditure', 0, 'expense', '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '6002', 'Salaries and Allowances', 1, 'expense',   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- GFR Rule 11 data fix: cap re_minor to be_minor where corrupt seed data exceeds sanctioned amount.
UPDATE budget.finance_budgets
SET re_minor = LEAST(re_minor, be_minor)
WHERE re_minor > be_minor;
