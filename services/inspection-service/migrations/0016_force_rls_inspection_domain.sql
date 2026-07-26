-- Purpose: Force row-level security on inspection domain tables that were created
--          with ENABLE ROW LEVEL SECURITY + a tenant_isolation policy but were
--          never FORCEd. Without FORCE, the table OWNER (the role the service
--          connects as) bypasses RLS entirely, so the tenant_isolation policy is
--          NOT applied on that connection — cross-tenant reads/writes leak.
--
--          The inspection DB roles are NOBYPASSRLS, but NOBYPASSRLS only prevents
--          the *global* bypass; table ownership still exempts a role from its own
--          tables' RLS unless FORCE ROW LEVEL SECURITY is set. This migration
--          closes that gap for the six schemas that lacked FORCE:
--            risk, planning, assignment, checklist, sync, execution
--          (universe [0001], evidence [0007], findings [0009] already FORCE.)
--
-- Idempotent: FORCE ROW LEVEL SECURITY is a no-op when already set; each table is
--             guarded with to_regclass so re-running (or running against a subset
--             of schemas) never errors.
-- Additive:   adds no columns, tables, or policies — only tightens enforcement.
-- Rollback:   ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;  (per table below)
-- Affected services: inspection-service

SET lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'risk.risk_models',
    'risk.risk_scores',
    'planning.inspection_plans',
    'assignment.inspection_assignments',
    'assignment.conflict_declarations',
    'assignment.tour_plans',
    'assignment.geo_attendance',
    'assignment.inspector_capacity',
    'checklist.checklist_templates',
    'checklist.checklist_instances',
    'sync.sync_packages',
    'sync.sync_uploads',
    'sync.sync_cursors',
    'execution.inspections',
    'execution.inspection_history'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
