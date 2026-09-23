-- Fix P1-FIN-005: Add liability, income, and expense accounts to Chart of Accounts.
-- Without these, Balance Sheet and P&L cannot be produced.
-- Also correct any seed data where re_minor > be_minor (GFR Rule 11 violation).

-- Seed demo accounts for the default tenant (00000000-0000-0000-0000-000000000001)
-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this file/sequence (see the
-- comment above), which is only true the FIRST time it is applied. On a
-- re-run against an already-migrated cluster, RLS is already active and
-- this session never otherwise sets app.tenant_id, so WITH CHECK would
-- reject this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK
-- on the candidate row before conflict resolution). Wrapped in a DO block using set_config('app.tenant_id', ..., true) --
-- SET LOCAL semantics (transaction-scoped to the DO block's own
-- implicit transaction under psql's per-statement autocommit), not a
-- raw session-scoped SET. This fleet routes through PgBouncer in
-- transaction-pooling mode (PERF-001): a raw SET leaves the GUC on the
-- shared backend connection for whichever unrelated client the pool
-- hands it to next -- a cross-tenant leak for a tenant-scoping GUC. See
-- scripts/ci/raw-session-guc-guard.mjs and the identical pattern in
-- services/audit-service/migrations/0025_fix_legacy_status_values.sql.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

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

END
$body$;
