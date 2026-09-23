-- Originally 0014: Seed the missing definition_edges for the demo-tenant
-- standard definitions. Migration 0003 inserted nodes but NO edges, so the
-- chains (file_noting SO→US→DS, etc.) could not advance — completing the
-- start task found zero outgoing edges and terminated immediately. This adds
-- the linear approve-advances edges. New tenants get these via the
-- provisioning consumer.
--
-- Renumbered from 0014_seed_definition_edges.sql to sort here, BEFORE
-- 0013_rls_tenant_isolation.sql. definition_edges has no tenant_id column of
-- its own (see workflow.definition_tenant() in 0013) and this file's INSERT
-- supplies no session tenant context, so once 0013 enables this table's FORCE
-- RLS policy (`workflow.definition_tenant(definition_id) =
-- workflow.current_tenant_id()`), current_tenant_id() correctly resolves to
-- NULL (fail-closed) and WITH CHECK rejects every row here with "new row
-- violates row-level security policy". Running before 0013 (table still
-- unrestricted — RLS has no effect until ENABLE ROW LEVEL SECURITY runs)
-- avoids that. All rows referenced (workflow.definitions from 0003, the
-- workflow.definition_edges table itself from 0005) already exist by this
-- point, so moving earlier needs no other change.

-- file_noting: draft → section_review → us_approve → ds_approve (terminal)
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

INSERT INTO workflow.definition_edges (id, definition_id, from_node, to_node, sort_order)
VALUES
  ('00000000-0000-4004-8001-000000000001', '00000000-0000-4002-8001-000000000004', 'draft',          'section_review', 1),
  ('00000000-0000-4004-8001-000000000002', '00000000-0000-4002-8001-000000000004', 'section_review', 'us_approve',     1),
  ('00000000-0000-4004-8001-000000000003', '00000000-0000-4002-8001-000000000004', 'us_approve',     'ds_approve',     1),
  -- leave_approval: apply → manager_approve → hr_approve (terminal)
  ('00000000-0000-4004-8001-000000000004', '00000000-0000-4002-8001-000000000001', 'apply',          'manager_approve', 1),
  ('00000000-0000-4004-8001-000000000005', '00000000-0000-4002-8001-000000000001', 'manager_approve','hr_approve',      1),
  -- finance_approval: submit → accounts_check → budget_officer → approve (terminal)
  ('00000000-0000-4004-8001-000000000006', '00000000-0000-4002-8001-000000000002', 'submit',         'accounts_check',  1),
  ('00000000-0000-4004-8001-000000000007', '00000000-0000-4002-8001-000000000002', 'accounts_check', 'budget_officer',  1),
  ('00000000-0000-4004-8001-000000000008', '00000000-0000-4002-8001-000000000002', 'budget_officer', 'approve',         1),
  -- procurement_approval: indent → dept_approve → finance_clear → po_issue (terminal)
  ('00000000-0000-4004-8001-000000000009', '00000000-0000-4002-8001-000000000003', 'indent',         'dept_approve',    1),
  ('00000000-0000-4004-8001-00000000000a', '00000000-0000-4002-8001-000000000003', 'dept_approve',   'finance_clear',   1),
  ('00000000-0000-4004-8001-00000000000b', '00000000-0000-4002-8001-000000000003', 'finance_clear',  'po_issue',        1),
  -- grant_disbursement: application → scrutiny → sanction → disbursed (terminal)
  ('00000000-0000-4004-8001-00000000000c', '00000000-0000-4002-8001-000000000005', 'application',    'scrutiny',        1),
  ('00000000-0000-4004-8001-00000000000d', '00000000-0000-4002-8001-000000000005', 'scrutiny',       'sanction',        1),
  ('00000000-0000-4004-8001-00000000000e', '00000000-0000-4002-8001-000000000005', 'sanction',       'disbursed',       1)
ON CONFLICT DO NOTHING;

END
$body$;
