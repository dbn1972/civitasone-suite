-- 0043: Reconcile DB schema with drizzle models + code (schema-drift fixups).
--
-- These columns/constraints are referenced by the drizzle schemas and the
-- runtime code (repos/consumers/queries) but were never added by a migration,
-- so reads/writes against them fail with "column ... does not exist" or a
-- stale CHECK constraint. Additive, idempotent, forward-only.

-- (a) budget.finance_sanctions.utilised_minor
--     src/modules/budget/{schema.ts,repo.ts} track sanction utilisation; the
--     UPDATE ... SET utilised_minor = utilised_minor + net logic and every
--     SELECT * against finance_sanctions require this column.
ALTER TABLE budget.finance_sanctions
  ADD COLUMN IF NOT EXISTS utilised_minor bigint NOT NULL DEFAULT 0;

-- (b) budget.finance_sanctions.status — allow the R11 maker-checker state.
--     The consumer creates sanctions as pending_approval and a checker moves
--     them to approved; the old CHECK (draft|approved|exhausted|cancelled)
--     rejected the pending_approval insert.
DO $$ BEGIN
  ALTER TABLE budget.finance_sanctions DROP CONSTRAINT IF EXISTS finance_sanctions_status_check;
  ALTER TABLE budget.finance_sanctions
    ADD CONSTRAINT finance_sanctions_status_check
    CHECK (status IN ('draft','pending_approval','approved','exhausted','cancelled'));
END $$;

-- (c) gl.finance_journal_lines denormalized head columns.
--     0030 created the table without them; the simplified consumer WRITES
--     head_code/head_name/head_classification and the simplified queries READ
--     head_code (LIKE ranges) for the MSME summary/cashflow reports.
ALTER TABLE gl.finance_journal_lines
  ADD COLUMN IF NOT EXISTS head_code           text,
  ADD COLUMN IF NOT EXISTS head_name           text,
  ADD COLUMN IF NOT EXISTS head_classification text;

-- (d) payments.finance_ddo audit/version columns (drizzle financeDdo expects them).
ALTER TABLE payments.finance_ddo
  ADD COLUMN IF NOT EXISTS version    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS updated_by uuid    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- (e) treasury.finance_bank_statement.version (drizzle bankStatement expects it).
ALTER TABLE treasury.finance_bank_statement
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- (f) budget.finance_major_heads is a GLOBAL CGA reference master (no tenant_id).
--     A prior RLS-completeness migration force-enabled ROW LEVEL SECURITY on it
--     but no policy applies (there is no tenant_id column), so FORCE RLS becomes
--     default-deny: every read returns zero rows, breaking HoA validation
--     (major head "not found in master") for bill/HoA paths. Disable RLS on it.
ALTER TABLE budget.finance_major_heads NO FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_major_heads DISABLE ROW LEVEL SECURITY;

-- (g) payments.finance_bills.stage — align the CHECK with the code stage machine.
--     domain.ts STAGE_TRANSITIONS advances section -> accounts -> pay, but the
--     constraint still carried the older names (audit/drawing/paid), so the
--     bill-approve gate could not persist stage = "accounts" (R5 3-way match).
DO $$ BEGIN
  ALTER TABLE payments.finance_bills DROP CONSTRAINT IF EXISTS finance_bills_stage_check;
  ALTER TABLE payments.finance_bills
    ADD CONSTRAINT finance_bills_stage_check
    CHECK (stage IN ('section','accounts','pay'));
END $$;
