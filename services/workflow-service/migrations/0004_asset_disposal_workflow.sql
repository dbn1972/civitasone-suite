-- Asset disposal approval workflow (Oracle FA / SAP AA retirement parity)

-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this service's migration
-- sequence, which is only true the FIRST time it is applied. On a re-run
-- against an already-migrated cluster, RLS is already active and this
-- session never otherwise sets app.tenant_id, so WITH CHECK would reject
-- this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK on the
-- candidate row before conflict resolution). Wrapped in a DO block using set_config('app.tenant_id', ..., true) --
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

INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
VALUES
  ('00000000-0000-4002-8001-000000000006', '00000000-0000-0000-0000-000000000001',
   'asset_disposal', 'Asset Disposal Approval', 1, 'active',
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
-- Conflict target is the stable `id` PK, not (tenant_id, code) -- see the
-- identical note in 0003_seed_definitions.sql (0005_engine_hardening.sql
-- later replaces the (tenant_id, code) unique constraint this used to rely
-- on with (tenant_id, code, version), which only exists after a fresh
-- CREATE TABLE, not after a re-run's no-op IF NOT EXISTS).
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow.definition_nodes (id, definition_id, node_key, name, role_ref, sort_order)
VALUES
  ('00000000-0000-4003-8001-000000000021', '00000000-0000-4002-8001-000000000006',
   'request', 'Disposal Request', 'asset_manager', 1),
  ('00000000-0000-4003-8001-000000000022', '00000000-0000-4002-8001-000000000006',
   'committee', 'Write-off Committee', 'asset_admin', 2),
  ('00000000-0000-4003-8001-000000000023', '00000000-0000-4002-8001-000000000006',
   'finance', 'Finance Clearance', 'finance_approver', 3),
  ('00000000-0000-4003-8001-000000000024', '00000000-0000-4002-8001-000000000006',
   'complete', 'Retirement Posted', NULL, 4)
-- Conflict target is the stable `id` PK for the same reason as the
-- definitions insert above: (definition_id, node_key)'s backing constraint
-- is subject to the same later-migration schema evolution elsewhere in this
-- service's history, and every row here already has a fixed literal id.
ON CONFLICT (id) DO NOTHING;

END
$body$;
