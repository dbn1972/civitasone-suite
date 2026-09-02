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
 * DELIBERATELY DOES NOT TOUCH leave.hrms_leave_types, unlike
 * scripts/dev/seed-all.mjs's hrms block. That script unconditionally
 * deletes and re-inserts the CL/EL rows by fixed id (eeeeeeee-...-007 /
 * ...-008) to get predictable ids for its own leave_allocs — but
 * migrations/0005_configurable_leave_policies.sql already creates CL and EL
 * with exactly those same fixed ids (CL first, so CL=...-007, EL=...-008 on
 * a fresh cluster) AND seeds leave.hrms_leave_policy_rules rows keyed to
 * them (permanent/contractual/vendor_deputed/deputation policies, see
 * leave-world-class.test.ts section 1). Re-running seed-all.mjs's delete
 * step here aborts with `violates foreign key constraint
 * hrms_leave_policy_rules_leave_type_id_fkey` on a freshly migrated,
 * unseeded database (verified). Renaming the rows in place (UPDATE instead
 * of DELETE) avoids the FK error but silently relabels those policy rows —
 * e.g. the row seeded as the CONTRACTUAL "CL" policy would end up joining to
 * a leave_type row now coded "EL", which breaks
 * leave-world-class.test.ts 1.3 ("contractual must not include EL"), a test
 * that passes today without this fixture at all. None of the four e2e
 * suites actually assert what CODE eeeeeeee-...-007 / ...-008 resolve to —
 * they only need the ids to exist and FK-resolve — so the fix is to leave
 * migration 0005's rows exactly as it created them and point this fixture's
 * leave_allocs / leave_apps at those same ids.
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

const T = "00000000-0000-0000-0000-000000000001"; // tenant_id (demo-tenant)
const A = "00000000-0000-0000-0000-000000000099"; // actor

let seededOnce: Promise<void> | undefined;

/** Idempotent. Safe to call from every suite's beforeAll — work happens once per test process. */
export function seedHrmsCoreFixtures(): Promise<void> {
  if (!seededOnce) seededOnce = doSeed();
  return seededOnce;
}

async function doSeed(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1 });
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

-- leave.hrms_leave_types is NOT touched here — migrations/0005 already
-- creates CL (eeeeeeee-...-007) and EL (eeeeeeee-...-008) on a fresh
-- cluster (see the file header). The leave_allocs/leave_apps rows below
-- reference those same ids as-is.

INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000009', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', 'eeeeeeee-0001-0000-0000-000000000007', '2024-25', 30, 25, now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000010', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', 'eeeeeeee-0001-0000-0000-000000000008', '2024-25', 15, 13, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO leave.hrms_leave_apps (id, tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, reason, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000011', '${T}', 'eeeeeeee-0001-0000-0000-000000000005', 'eeeeeeee-0001-0000-0000-000000000007', 'eeeeeeee-0001-0000-0000-000000000009', '2024-12-23', '2024-12-27', 5, 'Annual leave',  'approved', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000012', '${T}', 'eeeeeeee-0001-0000-0000-000000000006', 'eeeeeeee-0001-0000-0000-000000000008', 'eeeeeeee-0001-0000-0000-000000000010', '2024-12-30', '2024-12-31', 2, 'Personal work', 'pending',  now(), now(), '${A}', '${A}', 1)
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
  } finally {
    await sql.end({ timeout: 5 });
  }
}
