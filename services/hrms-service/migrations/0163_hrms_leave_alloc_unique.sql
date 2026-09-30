-- 0163_hrms_leave_alloc_unique.sql
-- GAP-HR-LEAVE-ALLOCATE-02: no synchronous check for an existing allocation
-- for the same (employee, leave type, FY), and no DB constraint either --
-- a double-submit (or a race between two concurrent submits) could create
-- two hrms_leave_allocs rows for the same employee+type+FY, which
-- context-routes.ts's GET /leave-context then lists as two separate
-- allocations. commands.ts now adds a synchronous pre-check (409
-- ALLOCATION_EXISTS) ahead of this migration, but that alone cannot close
-- the race between two concurrent requests both passing the pre-check
-- before either's INSERT commits -- hence the unique index below, with
-- repo.insertLeaveAlloc's consumer-side INSERT changed to
-- onConflictDoNothing() against it so a losing race is a silent no-op
-- (the winner's row stands) rather than a constraint-violation crash in the
-- async consumer.
--
-- Same RLS gotcha this module's own migration 0151 already documents and
-- fixes: leave.hrms_leave_allocs has FORCE ROW LEVEL SECURITY
-- (tenant_isolation_policy: tenant_id = current_tenant_id()), and this
-- migration runs as civitas_admin (NOSUPERUSER NOBYPASSRLS) with no
-- app.tenant_id set -- an unscoped DELETE below would silently affect ZERO
-- rows. Loop one tenant at a time, set_config('app.tenant_id', ..., true)
-- (transaction-local, inside the DO block only -- see 0151's own comment
-- for why a top-level SET LOCAL statement does nothing here) before each
-- tenant's cleanup DELETE.
--
-- Rollback:
--   DROP INDEX IF EXISTS leave.hrms_leave_allocs_tenant_emp_type_fy_uniq;
--   -- (the duplicate-cleanup DELETE below is not reversible; back up first
--   -- if any tenant is known to have relied on duplicate rows.)
-- Affected services: hrms-service only.

SET lock_timeout = '5s';

-- Duplicate cleanup: for any (tenant, employee, leave type, FY) with more
-- than one row, keep the most recently updated one (ties broken by id) and
-- delete the rest. Scoped per-tenant so FORCE RLS actually lets the DELETE
-- see its own tenant's rows (see comment above).
DO $$
DECLARE
  t uuid;
BEGIN
  PERFORM set_config('app.platform_bypass', 'true', true);

  FOR t IN SELECT DISTINCT tenant_id FROM employee.hrms_employees LOOP
    PERFORM set_config('app.tenant_id', t::text, true);

    DELETE FROM leave.hrms_leave_allocs a
    WHERE a.tenant_id = t
      AND a.id IN (
        SELECT id FROM (
          SELECT id,
                 row_number() OVER (
                   PARTITION BY employee_id, leave_type_id, fy
                   ORDER BY updated_at DESC, id DESC
                 ) AS rn
          FROM leave.hrms_leave_allocs
          WHERE tenant_id = t
        ) ranked
        WHERE ranked.rn > 1
      );
  END LOOP;
END
$$;

-- Idempotent re-run: IF NOT EXISTS, same convention as every other migration
-- in this fleet (see migrate-all.mjs's own docstring).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_leave_allocs_tenant_emp_type_fy_uniq
  ON leave.hrms_leave_allocs (tenant_id, employee_id, leave_type_id, fy);
