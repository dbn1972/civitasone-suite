-- idempotent seed: two default categories that internal consumers hard-code
--
-- Renumbered from 0020_seed_default_categories.sql to sort here, BEFORE
-- 0007_rls_tenant_isolation.sql. register.asset_categories.tenant_id is NOT
-- NULL (0001_init.sql) and this file's own migration session never sets the
-- app.tenant_id GUC, so once 0007 enables FORCE ROW LEVEL SECURITY +
-- `tenant_id = register.current_tenant_id()` on this table,
-- register.current_tenant_id() resolves to NULL and WITH CHECK rejects this
-- literal-tenant seed row with "new row violates row-level security policy".
-- Running before 0007 (table is still an ordinary unrestricted table — RLS
-- has no effect until ENABLE ROW LEVEL SECURITY runs) avoids that, matching
-- how every other seed-then-RLS sequence in this codebase is ordered (e.g.
-- workflow-service seeds workflow.definitions in 0003, RLS only added in
-- 0013). All columns referenced below already exist as of 0001_init.sql, so
-- moving this earlier needs no other change.

-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this file/sequence (see the
-- comment above), which is only true the FIRST time it is applied. On a
-- re-run against an already-migrated cluster, RLS is already active and
-- this session never otherwise sets app.tenant_id, so WITH CHECK would
-- reject this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK
-- on the candidate row before conflict resolution). Session-scoped (not
-- SET LOCAL): bootstrap-postgres.sh runs this file as its own psql -f
-- connection with per-statement autocommit, not one transaction.
SET app.tenant_id = '00000000-0000-0000-0000-000000000000';

INSERT INTO register.asset_categories
  (id, tenant_id, name, code, dep_method, dep_rate, useful_life_years,
   created_by, updated_by, created_at, updated_at)
VALUES
  ('77777777-0001-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'IT Equipment', 'IT', 'SLM', 33.33, 3,
   '00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000000',
   now(), now()),
  ('77777777-0001-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'Vehicle', 'VEH', 'WDV', 15.00, 7,
   '00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000000',
   now(), now())
ON CONFLICT (id) DO NOTHING;

RESET app.tenant_id;
