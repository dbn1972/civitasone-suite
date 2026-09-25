-- 0150_leave_type_lop_fraction.sql
-- HIGH fix: payroll's Loss-of-Pay calculation summed ALL approved leave days
-- with no regard for whether the leave type was paid or unpaid
-- (payroll-service's integration/consumer.ts unconditionally added every
-- approved leaveApproved event's daysApplied to the LOP ledger; hrms-service's
-- own live-pull internal/payroll-input feed did the same). hrms_leave_types
-- had no paid/unpaid classification anywhere in the schema to wire that
-- decision to.
--
-- lop_fraction_bps: basis points (0-10000) of each approved day of this
-- leave type that counts toward Loss-of-Pay. 0 = fully paid (no LOP),
-- 10000 = fully unpaid (full LOP), any value between expresses a
-- partially-paid type (e.g. CCS Half Pay Leave = 5000, exactly half) via a
-- fraction field rather than a hardcoded paid/unpaid boolean. Integer basis
-- points (not a float/percent) to mirror this codebase's existing DA-rate
-- convention (dearness_allowance_rates.rate_bps, employee/consumer.ts's
-- daRateBps) and keep every downstream computation in exact integer/bigint
-- arithmetic, never a float -- consistent with this fleet's money-precision
-- guard (scripts/ci/money-precision-guard.mjs).
--
-- Column DEFAULT 10000 (fully counts as LOP) is the fail-safe for any
-- future/custom leave type an HR admin creates (POST /v1/hrms/leave-types)
-- without explicitly setting this field. Mirrors this same module's own
-- established precedent for an ambiguous/unclassified case
-- (engagement-policy.ts's attendanceLopApplies default-to-true, and
-- internal/routes.ts's attendance-lop-applies 404 contract, whose caller
-- comment reads "a lookup miss/race never silently exempts an employee it
-- shouldn't"): silently treating an unclassified type as paid risks a
-- silent overpayment that's hard to audit after the fact; docking it as
-- unpaid by default is at least immediately visible to the employee on
-- their payslip and gets corrected fast once the type is properly
-- classified.
--
-- Existing rows backfilled below by code, using the only evidence this
-- codebase already provides for each (see migration 0005's seed data,
-- rules-engine.ts's LEAVE_POLICIES, and employee/consumer.ts's elEncashment
-- -- the full list of leave-type codes this codebase has ever seeded):
--
--  CL  (Casual Leave)        -> 0     paid.   Ordinary paid short leave --
--                                             seeded into every employee
--                                             type's policy rules
--                                             (migration 0005) and
--                                             rules-engine.ts's own
--                                             LEAVE_POLICIES with no
--                                             unpaid/LOP annotation
--                                             anywhere.
--  EL  (Earned Leave)        -> 0     paid.   employee/consumer.ts's own
--                                             elEncashment() pays unused EL
--                                             at (Basic+DA)/30 per day on
--                                             separation -- this codebase
--                                             already treats EL as
--                                             full-salary-rate leave, not
--                                             unpaid, while it is being
--                                             taken.
--  HPL (Half Pay Leave)      -> 5000  half.   Canonical CCS Half Pay Leave
--                                             (Rule 29) -- paid at exactly
--                                             half of Basic+DA by
--                                             definition. This codebase
--                                             already cites CCS leave/
--                                             pension rules verbatim
--                                             elsewhere (e.g. "Rule 39 CCS
--                                             Leave Rules" in
--                                             RetirementProcessWizard.tsx).
--  EOL (Extraordinary Leave) -> 10000 unpaid. Its own `name` column already
--                                             says "(without pay)" -- no
--                                             inference needed.
--  MED (Medical Leave)       -> left at the column default (10000/unpaid).
--                                             NOT a confident
--                                             classification -- flagged in
--                                             the accompanying PR
--                                             description as an open
--                                             product-policy question.
--                                             Nothing else in this codebase
--                                             (LEAVE_POLICIES, encashment
--                                             logic, the policy-rule seed's
--                                             own flags) evidences whether
--                                             THIS tenant's specific
--                                             "Medical Leave" type is meant
--                                             to be paid or unpaid.
--
-- Any other/custom tenant-created leave-type code not listed above is left
-- at the column default (10000) for the same reason as MED.
--
-- ADD COLUMN ... NOT NULL DEFAULT is a metadata-only change on PG11+ (the
-- default is stored in the catalog, not backfilled row-by-row) -- no
-- table rewrite, no long lock, same posture as migration 0147's ADD COLUMN.
--
-- Rollback:
--   ALTER TABLE leave.hrms_leave_types DROP CONSTRAINT IF EXISTS hrms_leave_types_lop_fraction_bps_range;
--   ALTER TABLE leave.hrms_leave_types DROP COLUMN IF EXISTS lop_fraction_bps;
-- Affected services: hrms-service, payroll-service (reads this via the new
-- internal/leave-types/:id/lop-fraction-bps endpoint -- no schema change on
-- the payroll-service side).

SET lock_timeout = '5s';

ALTER TABLE leave.hrms_leave_types
  ADD COLUMN IF NOT EXISTS lop_fraction_bps INTEGER NOT NULL DEFAULT 10000;

-- Idempotent re-run: DROP ... IF EXISTS + a plain ADD, same pattern as
-- migration 0149's status-check constraint. NOT VALID skips a full-table
-- scan to validate pre-existing rows (they all already satisfy the range,
-- being 10000 by default or one of the backfilled values below).
ALTER TABLE leave.hrms_leave_types
  DROP CONSTRAINT IF EXISTS hrms_leave_types_lop_fraction_bps_range;

ALTER TABLE leave.hrms_leave_types
  ADD CONSTRAINT hrms_leave_types_lop_fraction_bps_range
  CHECK (lop_fraction_bps >= 0 AND lop_fraction_bps <= 10000)
  NOT VALID;

-- Per-code backfill (idempotent: setting a value to itself on a re-run is a
-- no-op). Applied across every tenant that has a leave type with this code
-- -- these codes carry a standardised CCS meaning across tenants, not a
-- tenant-specific one.
--
-- Verification-pass fix -- empirically confirmed against a freshly migrated
-- database that a plain, unscoped UPDATE here silently affects ZERO rows:
-- leave.hrms_leave_types has FORCE ROW LEVEL SECURITY
-- (tenant_isolation_policy: tenant_id = current_tenant_id()); civitas_admin
-- (the role this and every migration actually runs as) is deliberately
-- NOSUPERUSER NOBYPASSRLS and nothing here ever set app.tenant_id, so the
-- WHERE clause matched no visible rows at all -- same root cause, and same
-- fix, as migration 0145's holiday backfill: never write cross-tenant
-- directly; loop one tenant at a time and re-enter that row's own tenant
-- context (set_config('app.tenant_id', ...)) before each UPDATE, so every
-- write is an ordinary, fully tenant-scoped, RLS-satisfying single-tenant
-- update -- no bypass needed or used for any write here. app.platform_bypass
-- is set only to discover the distinct tenant_id set via
-- employee.hrms_employees (migration 0133's platform_bypass SELECT policy),
-- exactly as 0145 already established -- it does not touch
-- hrms_leave_types's own policy at all.
SET app.platform_bypass = 'true';

DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM employee.hrms_employees LOOP
    PERFORM set_config('app.tenant_id', t::text, false);

    UPDATE leave.hrms_leave_types SET lop_fraction_bps = 0     WHERE tenant_id = t AND code = 'CL';
    UPDATE leave.hrms_leave_types SET lop_fraction_bps = 0     WHERE tenant_id = t AND code = 'EL';
    UPDATE leave.hrms_leave_types SET lop_fraction_bps = 5000  WHERE tenant_id = t AND code = 'HPL';
    UPDATE leave.hrms_leave_types SET lop_fraction_bps = 10000 WHERE tenant_id = t AND code = 'EOL';
    -- MED, and any other/custom code, intentionally left at the column default.
  END LOOP;
END
$$;
