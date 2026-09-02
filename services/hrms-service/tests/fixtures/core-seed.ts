/**
 * Scoped fixture seed for hrms-service e2e test suites.
 *
 * WHY THIS EXISTS: CI's `scripts/ci/bootstrap-postgres.sh` applies SCHEMA
 * migrations only. It never runs `scripts/dev/seed-all.mjs` — a 1000-line
 * script that seeds ~25 unrelated services and is hardcoded to
 * `docker exec civitasone-postgres ...`, so it cannot run against a generic
 * CI Postgres reached over PGHOST/PGPORT (no fixed container name exists
 * there). Several hrms-service e2e suites hardcode the exact demo UUIDs
 * seed-all.mjs's hrms-service block creates (departments, designations,
 * employees, leave types/allocations, attendance) and — against a
 * freshly-migrated but unseeded database — fail with 404s and
 * empty-list assertions that have nothing to do with the behaviour under
 * test.
 *
 * This file ports the hrms-service rows from that block (same fixed UUIDs,
 * same idempotent DELETE-then-INSERT-by-id pattern), executed with the same
 * `postgres` client + DATABASE_URL every other DB-touching test in this
 * suite already uses (see tests/manpower-rls.test.ts) — no docker exec, no
 * container-name coupling, no unrelated service databases touched.
 *
 * Call seedHrmsCoreFixtures() once from a suite's beforeAll, before
 * buildApp() is exercised. Safe to call from multiple suites/processes:
 * every statement is DELETE-by-business-key then INSERT-by-fixed-id, so
 * re-running it (including against a dev DB already seeded by
 * scripts/dev/seed-all.mjs) reproduces the exact same rows.
 *
 * PARALLEL-SUITE SAFETY: Vitest (and CI's `pnpm turbo test`) runs test
 * files in separate worker processes by default, and 3 files
 * (hr-ecosystem-e2e, geo-attendance-e2e, leave-world-class) each call this
 * from their own beforeAll. `seededOnce` below only memoizes within a
 * single worker, so on a genuinely fresh DB all 3 workers can race straight
 * into the DELETE-then-INSERT block concurrently. Concurrent callers can
 * each pass the DELETE (nothing to see yet) and then collide on the
 * fixed-id INSERTs before any of them has committed, which surfaces as a
 * `duplicate key value violates unique constraint
 * hrms_departments_tenant_id_code_key` even though every writer targets the
 * same fixed ids — the ON CONFLICT (id) target can't save a row that
 * conflicts on a *different* unique index while its conflicting sibling
 * transaction is still in flight and uncommitted. A session-level
 * `pg_advisory_lock` around the whole seed serializes concurrent callers
 * (they queue instead of racing); the redundant re-run this causes for the
 * 2nd/3rd caller is harmless since every statement is idempotent by design
 * (see above).
 *
 * DELIBERATELY DOES NOT TOUCH leave.hrms_leave_types, unlike
 * scripts/dev/seed-all.mjs. That script unconditionally deletes and
 * re-inserts the CL/EL rows by fixed id (eeeeeeee-...-007 / ...-008) to get
 * predictable ids for its own leave_allocs — but
 * migrations/0005_configurable_leave_policies.sql already creates CL and EL
 * per tenant AND seeds leave.hrms_leave_policy_rules rows keyed to them
 * (permanent/contractual/vendor_deputed/deputation policies, see
 * leave-world-class.test.ts section 1). Re-running seed-all.mjs's delete
 * step here aborts with `violates foreign key constraint
 * hrms_leave_policy_rules_leave_type_id_fkey` on a freshly migrated,
 * unseeded database (verified). Renaming the rows in place (UPDATE instead
 * of DELETE) avoids the FK error but silently relabels those policy rows —
 * e.g. the row seeded as the CONTRACTUAL "CL" policy would end up joining to
 * a leave_type row now coded "EL", which breaks
 * leave-world-class.test.ts 1.3 ("contractual must not include EL"), a test
 * that passes today without this fixture at all. None of the four e2e
 * suites actually assert what CODE a given leave_type_id resolves to — they
 * only need the ids to exist and FK-resolve — so the fix is to leave
 * migration 0005's rows exactly as it created them and point this fixture's
 * leave_allocs / leave_apps at whatever ids CL/EL actually got.
 *
 * THAT LAST PART used to be hardcoded (eeeeeeee-...-007 for CL, ...-008 for
 * EL) on the assumption that migration 0005 always assigns those two exact
 * ids — true only the FIRST time it runs for a tenant that has no CL/EL row
 * yet. Migration 0005 itself is insert-if-missing (see its header): when a
 * CL/EL row for tenant T already exists — a long-lived, hand-seeded, or
 * previously-migrated dev/CI Postgres, not a one-shot fresh cluster — it
 * REUSES that row's actual id and never touches -007/-008 at all. Verified
 * against this repo's own long-lived dev cluster: tenant T's CL/EL ids there
 * are eeeeeeee-...-053 / ...-052, not -007 / -008, so every leave-
 * application POST built around the hardcoded ids (geo-attendance-e2e.test.ts
 * F1, hr-ecosystem-e2e.test.ts 4.3, leave-world-class.test.ts 4.1) 404'd with
 * LEAVE_TYPE_NOT_FOUND — routes.ts's `types.find(t => t.id === body.leaveTypeId)`
 * simply never matched. Fixed by resolving the tenant's ACTUAL CL/EL ids by
 * code below (after migrations have created them) and handing them back to
 * every caller instead of assuming a fixed id anywhere.
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

const T = "00000000-0000-0000-0000-000000000001"; // tenant_id (demo-tenant)
const A = "00000000-0000-0000-0000-000000000099"; // actor (admin/system — also the
  // default JWT `sub` minted by the e2e suites' own `mint()` helpers, so it
  // must NOT be used as `created_by` on any row a test later tries to
  // approve/act-on as that same actor — see EMP1/EMP2 below for the leave
  // applications specifically.)

// Fixed advisory-lock key for this fixture's seed critical section. Only
// meaningful as "some app-wide-unique bigint" — value itself is arbitrary.
const SEED_LOCK_KEY = 918273645;

/**
 * Tenant T's actual CL/EL leave.hrms_leave_types ids, resolved by code
 * (not assumed) after migration 0005 has created them — see the file
 * header. Callers need these to build a leave-application payload whose
 * leaveTypeId will actually match a row for this tenant/database.
 */
export interface HrmsLeaveTypeIds {
  clLeaveTypeId: string;
  elLeaveTypeId: string;
}

let seededOnce: Promise<HrmsLeaveTypeIds> | undefined;

/** Idempotent. Safe to call from every suite's beforeAll — work happens once per test process. */
export function seedHrmsCoreFixtures(): Promise<HrmsLeaveTypeIds> {
  if (!seededOnce) seededOnce = doSeed();
  return seededOnce;
}

async function doSeed(): Promise<HrmsLeaveTypeIds> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    // Serialize concurrent callers (separate Vitest worker processes each
    // running their own doSeed()) so they queue instead of racing on the
    // DELETE-then-INSERT block below. Session-level (not xact-level)
    // because `max: 1` keeps this whole function on one dedicated
    // connection/session throughout — released explicitly in `finally`,
    // and automatically by Postgres if the process dies mid-seed anyway.
    await sql.unsafe(`select pg_advisory_lock(${SEED_LOCK_KEY})`);
    try {
      // Every hrms-service table this fixture writes to has FORCE ROW LEVEL
      // SECURITY (migrations 0026/0034), so even hrms_svc — which owns these
      // tables — cannot write without app.tenant_id set for the session. Set
      // it once; `max: 1` keeps every statement below on this one connection.
      await sql.unsafe(`select set_config('app.tenant_id', '${T}', false)`);

      await sql.unsafe(`
DELETE FROM employee.hrms_departments WHERE tenant_id = '${T}' AND code IN ('FIN', 'PWD');
DELETE FROM employee.hrms_designations WHERE tenant_id = '${T}' AND code IN ('IAS', 'STO');

INSERT INTO employee.hrms_departments (id, tenant_id, code, name, parent_id, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000001', '${T}', 'FIN', 'Finance',      null, now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000002', '${T}', 'PWD', 'Public Works', null, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, updated_at = now();

INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, pay_grade, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000003', '${T}', 'IAS', 'IAS Officer',     1, 'L14', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000004', '${T}', 'STO', 'Section Officer', 5, 'L9',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, basic_minor, currency, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000005', '${T}', 'EMP001', 'Ravi Kumar',   'eeeeeeee-0001-0000-0000-000000000001', 'eeeeeeee-0001-0000-0000-000000000003', '2010-01-15', 'permanent', 'confirmed', 14400000, 'INR', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000006', '${T}', 'EMP002', 'Priya Sharma', 'eeeeeeee-0001-0000-0000-000000000002', 'eeeeeeee-0001-0000-0000-000000000004', '2015-06-01', 'permanent', 'confirmed', 9000000,  'INR', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, department_id = EXCLUDED.department_id, updated_at = now();
`);

      // leave.hrms_leave_types is NOT touched here — migrations/0005 creates
      // CL/EL per tenant (see the file header for why their ids can't be
      // assumed fixed). Resolve tenant T's ACTUAL CL/EL ids by code instead.
      const clElRows = (await sql.unsafe(`
SELECT
  (SELECT id FROM leave.hrms_leave_types WHERE tenant_id = '${T}' AND code = 'CL' LIMIT 1) AS cl_id,
  (SELECT id FROM leave.hrms_leave_types WHERE tenant_id = '${T}' AND code = 'EL' LIMIT 1) AS el_id
`)) as unknown as { cl_id: string | null; el_id: string | null }[];
      const clId = clElRows[0]?.cl_id;
      const elId = clElRows[0]?.el_id;
      if (!clId || !elId) {
        throw new Error(
          `core-seed: tenant ${T} has no CL/EL row in leave.hrms_leave_types ` +
          `(cl_id=${clId ?? "null"}, el_id=${elId ?? "null"}). ` +
          "migrations/0005_configurable_leave_policies.sql creates these per " +
          "tenant on first run — apply hrms-service migrations " +
          "(scripts/ci/bootstrap-postgres.sh) before seeding fixtures.",
        );
      }

      await sql.unsafe(`
INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000009', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', '${clId}', '2024-25', 30, 25, now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000010', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', '${elId}', '2024-25', 15, 13, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

-- created_by/updated_by on these two are the *applicant* employee, not the
-- generic admin/system actor A. A is exactly the default JWT sub the e2e
-- suites' mint() helpers use, so seeding these as A made every seeded leave
-- application self-authored by whichever actor a test later approves as —
-- e.g. geo-attendance-e2e.test.ts "F3. RO approves leave" minted an
-- approver with sub=A, fetched this fixture's pending application (row
-- ...012, created_by=A), and hit routes.ts's SELF_APPROVAL_FORBIDDEN guard
-- (leaveApp.createdBy === ctx.actorId) as a false 403 — not a genuine
-- segregation-of-duties case. Using the applicant's own employee id here
-- reflects reality (an employee applies for their own leave) and keeps the
-- approver (a different actor) able to actually approve it.
INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, reason, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000011', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', '${clId}', 'eeeeeeee-0001-0000-0000-000000000009', '2024-12-23', '2024-12-27', 5, 'Annual leave',  'approved', now(), now(), 'eeeeeeee-0001-0000-0000-000000000005', 'eeeeeeee-0001-0000-0000-000000000005', 1),
  ('eeeeeeee-0001-0000-0000-000000000012', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', '${elId}', 'eeeeeeee-0001-0000-0000-000000000010', '2024-12-30', '2024-12-31', 2, 'Personal work', 'pending',  now(), now(), 'eeeeeeee-0001-0000-0000-000000000006', 'eeeeeeee-0001-0000-0000-000000000006', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO attendance.hrms_shifts (id, tenant_id, name, start_time, end_time, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000013', '${T}', 'Morning Shift', '09:00', '17:30', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000014', '${T}', 'General Shift', '10:00', '18:00', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO attendance.hrms_attendance (id, tenant_id, employee_id, attendance_date, status, in_time, out_time, source, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000015', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', '2024-12-01', 'present', '09:05', '17:35', 'biometric', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000016', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', '2024-12-01', 'present', '10:10', '18:05', 'biometric', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

UPDATE employee.hrms_employees
SET manager_id = 'eeeeeeee-0001-0000-0000-000000000005', updated_at = now()
WHERE id = 'eeeeeeee-0001-0000-0000-000000000006' AND tenant_id = '${T}';

INSERT INTO attendance.hrms_attendance_regularisations (id, tenant_id, employee_id, date, reason, requested_status, status, requested_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000017', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', '2024-11-28', 'Biometric missed due to field visit', 'present', 'pending',  now(), now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000018', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', '2024-11-15', 'Late mark — official meeting',       'present', 'approved', now(), now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO appraisal.hrms_appraisals (id, tenant_id, employee_id, appraisal_period, rating, status, reviewer_id, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000019', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', '2023-24', 4.5, 'completed', '${A}',  now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000020', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', '2023-24', 4.0, 'in_review', '${A}', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recruitment.hrms_job_openings (id, tenant_id, ref_no, title, department_id, designation_id, vacancies, description, status, posted_at, closes_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000021', '${T}', 'JOB/2024/001', 'Section Officer (Finance)', 'eeeeeeee-0001-0000-0000-000000000002', 'eeeeeeee-0001-0000-0000-000000000004', 2, 'Direct recruitment for finance section', 'open', '2024-11-01', '2025-01-31', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000022', '${T}', 'JOB/2024/002', 'Administrative Assistant',  'eeeeeeee-0001-0000-0000-000000000001', null,                                   1, 'Support staff for admin wing',           'open', '2024-12-01', '2025-02-28', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO training.hrms_trainings (id, tenant_id, title, venue, from_date, to_date, facilitator, max_participants, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000023', '${T}', 'GFR 2017 Procurement Training', 'Training Hall A', '2025-01-15', '2025-01-17', 'Institute of Govt Accounts', 30, 'planned', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000024', '${T}', 'Digital Governance Workshop',   'Conference Room B', '2024-12-10', '2024-12-11', 'NIC Delhi',                  25, 'planned', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

      return { clLeaveTypeId: clId, elLeaveTypeId: elId };
    } finally {
      await sql.unsafe(`select pg_advisory_unlock(${SEED_LOCK_KEY})`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
