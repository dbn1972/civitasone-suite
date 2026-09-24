-- Purpose: backfill a default national-holiday calendar for every tenant
--   this service already has employee data for but that has ZERO rows in
--   leave.hrms_holidays.
--
--   Data-gap follow-up to the sibling commit that consolidated
--   attendance/leave-sync.ts and internal/routes.ts's payroll LOP
--   calculation onto this table, removing a hardcoded RESTRICTED_HOLIDAYS
--   fallback that used to apply to every tenant regardless of whether it
--   had configured its own calendar. Checked directly: of the tenants with
--   any row in employee.hrms_employees, only a small handful have ever had
--   a single leave.hrms_holidays row. Every other tenant would go from "4
--   national holidays/year excluded from LOP" (the old hardcoded floor,
--   present for every tenant unconditionally) to "0 holidays excluded,
--   weekends only" the moment that consolidation ships, with no visible
--   error — payroll would silently start counting a gazetted national
--   holiday as a full loss-of-pay day for any employee on approved leave
--   that date, for any tenant that never configured its own calendar.
--
--   This is a one-time stop-gap, not a permanent fix: it seeds the same 4
--   fixed-date national holidays the old RESTRICTED_HOLIDAYS carried (dates
--   that don't move year to year, so they're safe to hardcode here — unlike
--   Holi/Diwali/Eid, which follow lunar calendars and this migration
--   deliberately does not guess at) for the current and next two years,
--   and ONLY for a tenant with zero existing rows — a tenant that has
--   configured even a single holiday of its own is left completely
--   untouched. created_by is the all-zero system-actor sentinel already
--   established by lifecycle/effective-scheduler.ts's SYSTEM_ACTOR, so
--   these rows are visibly distinguishable from anything a tenant admin
--   entered; tenants should review/replace them via the holidays module
--   (holidays/routes.ts) with their own state-specific calendar.
--
--   Does NOT address tenants onboarded AFTER this migration runs: no
--   onboarding/provisioning script in this codebase seeds hrms_holidays for
--   a brand-new tenant (checked scripts/dev/provision-silo-tenant.mjs,
--   scripts/dev/seed-all.mjs, scripts/demo/seed-demo.mjs — none touch this
--   table). That is a separate, pre-existing tenant-onboarding gap outside
--   hrms-service's own boundary (likely tenant-service/admin-service), not
--   fixed by this migration — flagged, not addressed here.
--
--   Idempotent and safe to re-run: this repo's migration runner
--   (scripts/dev/migrate-all.mjs) re-applies every .sql file on every
--   invocation — there is no migration ledger table. Re-running this after
--   a tenant has since gained its own row(s) (from this migration or a
--   tenant admin) is a no-op — the per-tenant NOT EXISTS guard below
--   re-checks fresh each time, and ON CONFLICT DO NOTHING guards the same
--   (tenant_id, date, name) uniqueness migration 0004's original seed
--   relied on.
--
-- Rollback: DELETE FROM leave.hrms_holidays WHERE created_by =
--   '00000000-0000-0000-0000-000000000000';
-- Affected services: hrms-service
--
-- Verification-pass fix — RLS blocked BOTH halves of the original
--   single-statement INSERT ... SELECT form, confirmed empirically against
--   a freshly migrated database with real employee.hrms_employees rows:
--
--   1. Read side: employee.hrms_employees has FORCE ROW LEVEL SECURITY
--      (tenant_isolation_policy: tenant_id = current_tenant_id()).
--      civitas_admin — the role this and every other migration actually
--      run as (scripts/dev/migrate-all.mjs, scripts/ci/bootstrap-
--      postgres.sh) — is deliberately NOSUPERUSER NOBYPASSRLS
--      (bootstrap_admin_role.sql), and no caller of this script sets
--      app.tenant_id, so a plain SELECT DISTINCT tenant_id FROM
--      employee.hrms_employees silently returned zero rows regardless of
--      real content. Same root cause migration 0133 already diagnosed and
--      fixed for this exact table, via an additional permissive
--      SELECT-only policy gated on the app.platform_bypass GUC (mirrors
--      admin-service's/payroll-service's scopedPlatformRead pattern) — set
--      below, before the tenant-discovery query.
--
--   2. Write side: leave.hrms_holidays has its OWN FORCE ROW LEVEL SECURITY
--      (tenant_isolation_policy, ALL commands, WITH CHECK tenant_id =
--      current_tenant_id()) and no platform_bypass policy of its own
--      (migration 0133 added one only for employee.hrms_employees's
--      SELECT). app.platform_bypass does not touch this policy at all, so
--      even with the read side fixed, a single cross-tenant INSERT ...
--      SELECT DISTINCT still failed every row with "new row violates
--      row-level security policy for table hrms_holidays" — confirmed
--      empirically. No role available to this migration has genuine
--      BYPASSRLS to write across tenants directly (the same gap commit
--      1081eade already found and flagged, separately, for
--      scheduler/tick.ts's cross-tenant query — that fix deferred it; this
--      migration cannot). The safe fix is the one migration 0144 already
--      established for cross-tenant work in this same branch: never write
--      cross-tenant directly; instead loop one tenant at a time and
--      re-enter that row's own tenant context (set_config('app.tenant_id',
--      ...)) before its insert, so every write is an entirely ordinary,
--      fully tenant-scoped, RLS-satisfying single-tenant insert — no
--      bypass needed or used for any write here. This also makes the
--      per-tenant "does it already have a row" guard correctly
--      tenant-scoped for the same reason: leave.hrms_holidays has no
--      cross-tenant SELECT bypass either, so that check must run under the
--      same per-tenant app.tenant_id to see its own existing rows at all.
--
--   Session-scoped SET/set_config (not transaction-local) is correct and
--   sufficient here, matching lock_timeout below: this script's connection
--   is a one-shot migration run, never pooled or reused for any other
--   tenant's request, unlike the app-code callers of scopedPlatformRead.

SET lock_timeout = '5s';
SET app.platform_bypass = 'true';

DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM employee.hrms_employees LOOP
    PERFORM set_config('app.tenant_id', t::text, false);

    IF NOT EXISTS (SELECT 1 FROM leave.hrms_holidays WHERE tenant_id = t) THEN
      INSERT INTO leave.hrms_holidays (tenant_id, name, date, type, created_by)
      SELECT t, h.name, h.date, 'gazetted', '00000000-0000-0000-0000-000000000000'
      FROM (VALUES
        ('Republic Day',       DATE '2026-01-26'),
        ('Independence Day',   DATE '2026-08-15'),
        ('Gandhi Jayanti',     DATE '2026-10-02'),
        ('Christmas',          DATE '2026-12-25'),
        ('Republic Day',       DATE '2027-01-26'),
        ('Independence Day',   DATE '2027-08-15'),
        ('Gandhi Jayanti',     DATE '2027-10-02'),
        ('Christmas',          DATE '2027-12-25'),
        ('Republic Day',       DATE '2028-01-26'),
        ('Independence Day',   DATE '2028-08-15'),
        ('Gandhi Jayanti',     DATE '2028-10-02'),
        ('Christmas',          DATE '2028-12-25')
      ) AS h(name, date)
      ON CONFLICT (tenant_id, date, name) DO NOTHING;
    END IF;
  END LOOP;
END
$$;
