-- Data fix, split from the schema fix in 0026 per this repo's migration
-- convention (schema changes and data changes go in separate files).
--
-- Root cause: 0016_check_constraints_status_columns.sql added NOT VALID
-- CHECK constraints on nine status columns, then attempted to VALIDATE all
-- nine. On a fresh container all nine validate cleanly. On the long-lived
-- shared dev DB, three of the nine VALIDATE statements have been failing
-- ever since (confirmed via pg_constraint.convalidated = false for exactly
-- these three), because three seed rows for the DEV DEMO tenant
-- (00000000-0000-0000-0000-000000000001) predate the current status enum
-- and use since-renamed values. FORCE ROW LEVEL SECURITY on these tables
-- hides the rows from an ad-hoc SELECT run without a matching
-- app.tenant_id GUC (audit_svc lacks BYPASSRLS), which is why a first pass
-- checking "any rows violate the constraint?" against no tenant context
-- came back empty even though VALIDATE CONSTRAINT -- which scans the raw
-- heap and is not filtered by RLS -- failed. Confirmed live application
-- code (services/audit-service/src) no longer writes any of 'approved',
-- 'planned', or 'pending_reply' anywhere outside tests, so this is pure
-- seed-data drift, not an active write-path bug.
--
-- Mapping applied (chosen from each row's own dates/context, not a blanket
-- rule -- see PR description for the row-by-row detail):
--   plan.audit_plans        id=...0003  'approved'      -> 'completed'
--     ("Annual Audit Plan 2024-25", period_to 2025-03-31, long elapsed)
--   plan.audit_plan_items   id=...0021  'planned'       -> 'scheduled'
--     (direct rename; the row's own scheduled_from/scheduled_to columns
--     confirm 'scheduled' is this domain's current term)
--   observation.audit_observations id=...0006 'pending_reply' -> 'open'
--     ("awaiting reply" maps to the current open/replied state machine)
--
-- Scoped strictly by primary key + tenant, not by status value, so this
-- cannot touch any other row anywhere (including on a fresh container,
-- where these ids simply do not exist and every UPDATE below affects zero
-- rows).
--
-- Idempotent: re-running after the values are already corrected is a
-- no-op (the WHERE clause no longer matches).

SET lock_timeout = '5s';

DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

  UPDATE plan.audit_plans
     SET status = 'completed'
   WHERE id = '99999999-0001-0000-0000-000000000003'
     AND status = 'approved';

  UPDATE plan.audit_plan_items
     SET status = 'scheduled'
   WHERE id = '99999999-0001-0000-0000-000000000021'
     AND status = 'planned';

  UPDATE observation.audit_observations
     SET status = 'open'
   WHERE id = '99999999-0001-0000-0000-000000000006'
     AND status = 'pending_reply';
END
$body$;
