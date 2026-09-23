-- Iter1: 7th CPC Dearness Allowance rate table (effective-dated, basis points).
CREATE TABLE IF NOT EXISTS payroll.dearness_allowance_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  effective_from date NOT NULL,
  rate_bps       integer NOT NULL,           -- 5000 = 50.00%
  order_ref      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_from)
);
-- Seed current DA = 50% effective 2026-01-01 for the demo tenant.
-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this file/sequence (see the
-- comment above), which is only true the FIRST time it is applied. On a
-- re-run against an already-migrated cluster, RLS is already active and
-- this session never otherwise sets app.tenant_id, so WITH CHECK would
-- reject this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK
-- on the candidate row before conflict resolution). Session-scoped (not
-- SET LOCAL): bootstrap-postgres.sh runs this file as its own psql -f
-- connection with per-statement autocommit, not one transaction.
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps, order_ref)
VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', 5000, 'MoF OM (seed)')
ON CONFLICT (tenant_id, effective_from) DO NOTHING;

RESET app.tenant_id;
