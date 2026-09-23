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

INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps, order_ref)
VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', 5000, 'MoF OM (seed)')
ON CONFLICT (tenant_id, effective_from) DO NOTHING;

END
$body$;
