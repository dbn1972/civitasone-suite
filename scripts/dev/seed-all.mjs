#!/usr/bin/env node
/**
 * seed-all.mjs — insert ≥2 rows per primary table across ALL services.
 * Idempotent: DELETE by business key then INSERT with fixed UUIDs.
 * Tenant: 00000000-0000-0000-0000-000000000001 (demo-tenant)
 * Actor:  00000000-0000-0000-0000-000000000099 (seed actor)
 *
 * Usage: node scripts/dev/seed-all.mjs
 */
import { execSync } from "node:child_process";

const T  = "00000000-0000-0000-0000-000000000001";  // tenant_id (demo-tenant)
const T2 = "00000000-0000-0000-0000-000000000002";  // second tenant
const A  = "00000000-0000-0000-0000-000000000099";  // actor

let seeded = 0;
let errors = 0;

function psql(db, sql) {
  try {
    execSync(
      `docker exec -i civitasone-postgres psql -U civitas_admin -d ${db} -v ON_ERROR_STOP=1`,
      { input: sql, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    const msg = ((err.stderr ?? "") + (err.stdout ?? "")).toString().trim();
    console.error(`  [ERR] ${db}: ${msg.slice(0, 400)}`);
    errors++;
  }
}

function seed(db, label, sql) {
  psql(db, sql);
  seeded++;
  console.log(`  seeded ${label}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== tenant-service ===");
seed("civitas_tenant", "tenants", `
INSERT INTO tenant.tenants (id, tenant_id, name, domain, edition, status, region, residency, settings, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('${T}',  '${T}',  'Demo Government Dept', 'demo-govt.civitasone.in', 'govt_dept', 'active', 'ap-south-1', 'in', '{}', now(), now(), '${A}', '${A}', 1),
  ('${T2}', '${T2}', 'Test PSU Office',       'test-psu.civitasone.in',  'psu',       'active', 'ap-south-1', 'in', '{}', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== identity-service ===");
seed("civitas_identity", "users+sessions", `
INSERT INTO users.users (id, tenant_id, email, name, status, mfa_enabled, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('${A}',  '${T}', 'admin@demo.gov.in',   'Demo Admin',      'active', false, now(), now(), '${A}', '${A}', 1),
  ('00000000-0000-0000-0000-000000000002', '${T}', 'finance@demo.gov.in', 'Finance Officer', 'active', false, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions.sessions (id, tenant_id, user_id, ip, device, status, started_at, expires_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0001-0000-0000-000000000001', '${T}', '${A}', '127.0.0.1', 'dev-seed/1.0', 'active', now(), now() + interval '1 day', now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0001-0000-0000-000000000002', '${T}', '00000000-0000-0000-0000-000000000002', '127.0.0.1', 'dev-seed/1.0', 'active', now(), now() + interval '1 day', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== policy-service ===");
// Delete old-UUID rows that conflict on UNIQUE(tenant_id, name)
seed("civitas_policy", "roles+bindings", `
DELETE FROM roles.roles WHERE tenant_id = '${T}' AND name IN ('super_admin', 'finance_admin');

INSERT INTO roles.roles (id, tenant_id, name, description, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('bbbbbbbb-0001-0000-0000-000000000001', '${T}', 'super_admin',   'Super administrator',   'active', now(), now(), '${A}', '${A}', 1),
  ('bbbbbbbb-0001-0000-0000-000000000002', '${T}', 'finance_admin', 'Finance module admin',  'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO bindings.bindings (id, tenant_id, user_id, role_id, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('cccccccc-0001-0000-0000-000000000001', '${T}', '${A}', 'bbbbbbbb-0001-0000-0000-000000000001', 'active', now(), now(), '${A}', '${A}', 1),
  ('cccccccc-0001-0000-0000-000000000002', '${T}', '00000000-0000-0000-0000-000000000002', 'bbbbbbbb-0001-0000-0000-000000000002', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== finance-service ===");
// Delete old-UUID heads rows before inserting with new UUIDs
seed("civitas_finance", "heads+budgets+sanctions+bills+payments+journals", `
DELETE FROM budget.finance_heads WHERE tenant_id = '${T}' AND code IN ('2055', '4059');

INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000001', '${T}', '2055', 'Police - General Administration', 0, 'revenue', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000002', '${T}', '4059', 'Capital Outlay on Public Works',  0, 'capital', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO budget.finance_budgets (id, tenant_id, head_id, fy, be_minor, re_minor, allocated_minor, utilised_minor, currency, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000003', '${T}', 'dddddddd-0001-0000-0000-000000000001', '2024-25', 500000000, 520000000, 400000000, 350000000, 'INR', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000004', '${T}', 'dddddddd-0001-0000-0000-000000000002', '2024-25', 200000000, 200000000, 180000000, 120000000, 'INR', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO budget.finance_sanctions (id, tenant_id, sanction_no, purpose, head_id, amount_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000005', '${T}', 'SAN/2024/001', 'Office renovation supplies', 'dddddddd-0001-0000-0000-000000000001', 50000000, 'INR', 'approved', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000006', '${T}', 'SAN/2024/002', 'Road widening equipment',    'dddddddd-0001-0000-0000-000000000002', 20000000, 'INR', 'approved', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments.finance_bills (id, tenant_id, bill_no, vendor_id, head_id, gross_minor, net_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000007', '${T}', 'BILL/2024/0001', 'eeeeeeee-0001-0000-0000-000000000001', 'dddddddd-0001-0000-0000-000000000001', 5000000, 4750000, 'INR', 'approved', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000008', '${T}', 'BILL/2024/0002', 'eeeeeeee-0001-0000-0000-000000000002', 'dddddddd-0001-0000-0000-000000000001', 3000000, 2850000, 'INR', 'pending',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments.finance_payments (id, tenant_id, bill_id, mode, amount_minor, currency, utr, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000009', '${T}', 'dddddddd-0001-0000-0000-000000000007', 'RTGS', 4750000, 'INR', 'RTGS2024001', 'released', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000010', '${T}', 'dddddddd-0001-0000-0000-000000000008', 'NEFT', 2850000, 'INR', null,          'initiated', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO gl.finance_journals (id, tenant_id, voucher_no, type, posting_date, lines, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000011', '${T}', 'JV/2024/001', 'payment', '2024-12-01', '[{"accountCode":"2055","debitMinor":5000000,"creditMinor":0}]', 'posted', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000012', '${T}', 'JV/2024/002', 'budget',  '2024-12-01', '[{"accountCode":"4059","debitMinor":20000000,"creditMinor":0}]', 'posted', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

UPDATE gl.finance_journals SET lines = '[{"accountCode":"2055","debitMinor":5000000,"creditMinor":0}]'::jsonb
WHERE tenant_id = '${T}' AND id = 'dddddddd-0001-0000-0000-000000000011';
UPDATE gl.finance_journals SET lines = '[{"accountCode":"4059","debitMinor":20000000,"creditMinor":0}]'::jsonb
WHERE tenant_id = '${T}' AND id = 'dddddddd-0001-0000-0000-000000000012';

INSERT INTO gl.finance_ledger (id, tenant_id, head_id, debit_minor, credit_minor, balance_minor, voucher_no, posting_date, currency, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000013', '${T}', 'dddddddd-0001-0000-0000-000000000001', 350000000, 50000000, 300000000, 'JV/2024/001', '2024-12-01', 'INR', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000014', '${T}', 'dddddddd-0001-0000-0000-000000000002', 120000000, 20000000, 100000000, 'JV/2024/002', '2024-12-01', 'INR', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments.finance_advances (id, tenant_id, advance_no, beneficiary, type, amount_minor, currency, disbursed_date, due_date, adjusted_minor, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000015', '${T}', 'ADV/2024/001', 'Ravi Kumar',   'employee', 5000000,  'INR', '2024-11-01', '2025-03-31', 2000000, 'active',  now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000016', '${T}', 'ADV/2024/002', 'TechSupplies', 'vendor',   10000000, 'INR', '2024-10-15', '2025-01-15', 0,       'active',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments.finance_uc (id, tenant_id, uc_no, grant_ref, grantee, amount_minor, currency, period_from, period_to, submitted_date, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0001-0000-0000-000000000017', '${T}', 'UC/2024/001', 'PMGSY-2024', 'District PWD', 1500000000, 'INR', '2024-04-01', '2024-09-30', '2024-10-15', 'submitted', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0001-0000-0000-000000000018', '${T}', 'UC/2024/002', 'SCM-2024',   'Smart City Corp', 950000000, 'INR', '2024-04-01', '2024-09-30', null,         'pending',   now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== hrms-service ===");
// Delete old-UUID rows that conflict on UNIQUE(tenant_id, code)
seed("civitas_hrms", "depts+desig+employees+leave_types+allocs+apps+shifts+attendance", `
DELETE FROM employee.hrms_departments WHERE tenant_id = '${T}' AND code IN ('ADMIN', 'FIN');
DELETE FROM employee.hrms_designations WHERE tenant_id = '${T}' AND code IN ('IAS', 'STO');
DELETE FROM leave.hrms_leave_types WHERE tenant_id = '${T}' AND code IN ('EL', 'CL');

INSERT INTO employee.hrms_departments (id, tenant_id, code, name, parent_id, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000001', '${T}', 'ADMIN', 'Administration', null, now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000002', '${T}', 'FIN',   'Finance',        null, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, pay_grade, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000003', '${T}', 'IAS', 'IAS Officer',     1, 'L14', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000004', '${T}', 'STO', 'Section Officer', 5, 'L9',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, basic_minor, currency, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000005', '${T}', 'EMP001', 'Ravi Kumar',   'eeeeeeee-0001-0000-0000-000000000001', 'eeeeeeee-0001-0000-0000-000000000003', '2010-01-15', 'permanent', 'confirmed', 14400000, 'INR', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000006', '${T}', 'EMP002', 'Priya Sharma', 'eeeeeeee-0001-0000-0000-000000000002', 'eeeeeeee-0001-0000-0000-000000000004', '2015-06-01', 'permanent', 'confirmed', 9000000,  'INR', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, carry_forward, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000007', '${T}', 'EL', 'Earned Leave', 30, true,  now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000008', '${T}', 'CL', 'Casual Leave', 15, false, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

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

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== payroll-service ===");
// payroll_components: code(required), fixed_minor (not amount_minor)
seed("civitas_payroll", "structures+components+runs+slips", `
INSERT INTO payroll.payroll_structures (id, tenant_id, name, description, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('ffffffff-0001-0000-0000-000000000001', '${T}', '7th CPC L14', 'IAS pay structure 7th CPC',   'active', now(), now(), '${A}', '${A}', 1),
  ('ffffffff-0001-0000-0000-000000000002', '${T}', '7th CPC L9',  'Section officer pay structure', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payroll.payroll_components (id, tenant_id, structure_id, code, name, component_type, is_taxable, fixed_minor, currency, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('ffffffff-0001-0000-0000-000000000003', '${T}', 'ffffffff-0001-0000-0000-000000000001', 'BASIC', 'Basic Pay', 'earning', false, 14400000, 'INR', now(), now(), '${A}', '${A}', 1),
  ('ffffffff-0001-0000-0000-000000000004', '${T}', 'ffffffff-0001-0000-0000-000000000001', 'HRA',   'HRA',       'earning', false, 4320000,  'INR', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, total_gross_minor, total_net_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('ffffffff-0001-0000-0000-000000000005', '${T}', 'RUN/2024/12', '2024-12', 'ffffffff-0001-0000-0000-000000000001', 29000000, 24500000, 'INR', 'disbursed', now(), now(), '${A}', '${A}', 1),
  ('ffffffff-0001-0000-0000-000000000006', '${T}', 'RUN/2024/11', '2024-11', 'ffffffff-0001-0000-0000-000000000001', 29000000, 24500000, 'INR', 'disbursed', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, total_deductions_minor, net_pay_minor, currency, components, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('ffffffff-0001-0000-0000-000000000007', '${T}', 'ffffffff-0001-0000-0000-000000000005', 'eeeeeeee-0001-0000-0000-000000000005', 'EMP001', 14400000, 20000000, 3000000, 17000000, 'INR', '[]', 'paid', now(), now(), '${A}', '${A}', 1),
  ('ffffffff-0001-0000-0000-000000000008', '${T}', 'ffffffff-0001-0000-0000-000000000005', 'eeeeeeee-0001-0000-0000-000000000006', 'EMP002', 9000000,  12000000, 2000000, 10000000, 'INR', '[]', 'paid', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== procurement-service ===");
// vendors: NO status column; has vendor_type (NOT NULL, default 'registered')
// pos: indent_ref(text) not indent_id(uuid)
// grns: po_ref(text) not po_id(uuid), received_date(date) not received_at
seed("civitas_procurement", "vendors+indents+pos+grns", `
INSERT INTO vendor.procurement_vendors (id, tenant_id, name, pan, gstin, email, phone, vendor_type, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0001-0000-0000-000000000001', '${T}', 'TechSupplies Pvt Ltd', 'AABCT1234D', '29AABCT1234D1Z5', 'tech@supplier.com',    '9999900001', 'registered', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0001-0000-0000-000000000002', '${T}', 'OfficeWorks Ltd',      'AACWO5678F', '27AACWO5678F1Z3', 'sales@officeworks.com', '9999900002', 'registered', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO indent.procurement_indents (id, tenant_id, indent_no, department, purpose, status, indent_date, required_by, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0002-0000-0000-000000000001', '${T}', 'IND/2024/001', 'ADMIN', 'Office stationery requirement', 'approved', '2024-11-01', '2025-01-31', now(), now(), '${A}', '${A}', 1),
  ('11111111-0002-0000-0000-000000000002', '${T}', 'IND/2024/002', 'FIN',   'Computer peripherals',          'pending',  '2024-11-15', '2025-02-28', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO po.procurement_pos (id, tenant_id, po_no, vendor_id, indent_ref, total_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0002-0000-0000-000000000003', '${T}', 'PO/2024/001', 'eeeeeeee-0001-0000-0000-000000000001', 'IND/2024/001', 1500000, 'INR', 'approved', now(), now(), '${A}', '${A}', 1),
  ('11111111-0002-0000-0000-000000000004', '${T}', 'PO/2024/002', 'eeeeeeee-0001-0000-0000-000000000002', 'IND/2024/002', 3500000, 'INR', 'draft',    now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO grn.procurement_grns (id, tenant_id, grn_no, po_ref, vendor_id, received_date, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0002-0000-0000-000000000005', '${T}', 'GRN/2024/001', 'PO/2024/001', 'eeeeeeee-0001-0000-0000-000000000001', '2024-12-15', 'accepted', now(), now(), '${A}', '${A}', 1),
  ('11111111-0002-0000-0000-000000000006', '${T}', 'GRN/2024/002', 'PO/2024/001', 'eeeeeeee-0001-0000-0000-000000000001', '2024-12-20', 'draft',    now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rfq.procurement_rfqs (id, tenant_id, rfq_no, title, description, indent_ref, vendors_invited, responses_received, closing_date, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0003-0000-0000-000000000001', '${T}', 'RFQ/2024/001', 'Office stationery RFQ', 'Annual stationery supply', 'IND/2024/001', 5, 3, '2024-12-31', 'issued', now(), now(), '${A}', '${A}', 1),
  ('11111111-0003-0000-0000-000000000002', '${T}', 'RFQ/2024/002', 'Computer peripherals RFQ', 'Laptops and accessories', 'IND/2024/002', 4, 2, '2025-01-31', 'draft',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tender.procurement_tenders (id, tenant_id, tender_no, title, scope, eligibility, type, estimated_minor, currency, publish_date, bid_closing_date, opening_date, bids_received, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0003-0000-0000-000000000003', '${T}', 'TND/2024/001', 'Road maintenance works', 'Annual maintenance of district roads', 'Class A contractors', 'open', 5000000000, 'INR', '2024-10-01', '2024-11-30', '2024-12-05', 4, 'published', now(), now(), '${A}', '${A}', 1),
  ('11111111-0003-0000-0000-000000000004', '${T}', 'TND/2024/002', 'IT infrastructure upgrade', 'Server and network equipment', 'Registered IT vendors', 'limited', 1200000000, 'INR', '2024-11-01', '2024-12-15', '2024-12-20', 2, 'evaluation', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== contract-service ===");
// contracts: value_minor (not amount_minor), expiry (not end_date)
seed("civitas_contract", "contracts+milestones", `
INSERT INTO contracts.contract_contracts (id, tenant_id, contract_no, title, vendor_id, value_minor, currency, status, start_date, expiry, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('22222222-0001-0000-0000-000000000001', '${T}', 'CON/2024/001', 'Annual Maintenance Contract', 'eeeeeeee-0001-0000-0000-000000000001', 5000000,  'INR', 'active', '2024-04-01', '2025-03-31', now(), now(), '${A}', '${A}', 1),
  ('22222222-0001-0000-0000-000000000002', '${T}', 'CON/2024/002', 'Software License Agreement',  'eeeeeeee-0001-0000-0000-000000000002', 12000000, 'INR', 'active', '2024-04-01', '2025-03-31', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO contracts.contract_milestones (id, contract_id, tenant_id, title, due_date, amount_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('22222222-0001-0000-0000-000000000003', '22222222-0001-0000-0000-000000000001', '${T}', 'Q1 Delivery', '2024-06-30', 1250000, 'INR', 'completed', now(), now(), '${A}', '${A}', 1),
  ('22222222-0001-0000-0000-000000000004', '22222222-0001-0000-0000-000000000001', '${T}', 'Q2 Delivery', '2024-09-30', 1250000, 'INR', 'pending',   now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== citizen-service ===");
// service_categories: NO slug (just name, description)
// citizen_services: NO slug/sla_days; has active(boolean) not status
seed("civitas_citizen", "categories+services+profiles+applications+grievances+rti", `
INSERT INTO portal.citizen_service_categories (id, tenant_id, name, description, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0001-0000-0000-000000000001', '${T}', 'Revenue Services', 'Land and revenue related services', now(), now(), '${A}', '${A}', 1),
  ('33333333-0001-0000-0000-000000000002', '${T}', 'Public Health',    'Health department services',        now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO portal.citizen_services (id, tenant_id, category_id, name, description, active, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0001-0000-0000-000000000003', '${T}', '33333333-0001-0000-0000-000000000001', 'Income Certificate', 'Income certificate from tahsildar', true, now(), now(), '${A}', '${A}', 1),
  ('33333333-0001-0000-0000-000000000004', '${T}', '33333333-0001-0000-0000-000000000002', 'Birth Certificate',  'Birth certificate from municipality', true, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO portal.citizen_profiles (id, tenant_id, name, mobile, digilocker_token, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0001-0000-0000-000000000005', '${T}', 'Arun Patel',  '9876541001', 'DL_TKN_001', now(), now(), '${A}', '${A}', 1),
  ('33333333-0001-0000-0000-000000000006', '${T}', 'Sunita Devi', '9876541002', 'DL_TKN_002', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO application.citizen_applications (id, tenant_id, citizen_id, service_id, ref_no, status, submitted_at, deadline, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0001-0000-0000-000000000007', '${T}', '33333333-0001-0000-0000-000000000005', '33333333-0001-0000-0000-000000000003', 'APP/2024/001', 'submitted', now(), (now() + interval '7 days')::date, now(), now(), '${A}', '${A}', 1),
  ('33333333-0001-0000-0000-000000000008', '${T}', '33333333-0001-0000-0000-000000000006', '33333333-0001-0000-0000-000000000004', 'APP/2024/002', 'approved',  now(), (now() + interval '3 days')::date, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO grievance.citizen_grievances (id, tenant_id, citizen_id, category, subject, description, priority, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0001-0000-0000-000000000009', '${T}', '33333333-0001-0000-0000-000000000005', 'infrastructure', 'Road not repaired',  'Pothole on main road since 3 months', 'high',   'registered', now(), now(), '${A}', '${A}', 1),
  ('33333333-0001-0000-0000-000000000010', '${T}', '33333333-0001-0000-0000-000000000006', 'utilities',      'Water supply issue', 'No water supply for 2 days',          'normal', 'registered', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rti.citizen_rti_requests (id, tenant_id, citizen_id, rti_no, subject, description, cpio_ref, deadline, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0001-0000-0000-000000000011', '${T}', '33333333-0001-0000-0000-000000000005', 'RTI/2024/001', 'Road repair expenditure',  'Details of expenditure on road repair works 2023-24', '${A}', (now() + interval '30 days')::date, 'filed', now(), now(), '${A}', '${A}', 1),
  ('33333333-0001-0000-0000-000000000012', '${T}', '33333333-0001-0000-0000-000000000006', 'RTI/2024/002', 'Staff attendance records', 'Attendance records of officers for Q1 2024',          '${A}', (now() + interval '30 days')::date, 'filed', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== project-service ===");
// schemes: NO ministry/start_fy/end_fy/currency; has type(NOT NULL), funding_pattern(NOT NULL)
// milestones: name(not title), planned_date(not due_date), payment_minor, currency
// fund_releases: scheme_id, component_id(NOT NULL), to_entity(NOT NULL)
seed("civitas_project", "schemes+components+projects+milestones+fund_releases", `
INSERT INTO scheme.project_schemes (id, tenant_id, code, name, type, funding_pattern, total_outlay_minor, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('44444444-0001-0000-0000-000000000001', '${T}', 'PMGSY-2024', 'PMGSY Road Development', 'css', '60:40', 50000000000,  'active', now(), now(), '${A}', '${A}', 1),
  ('44444444-0001-0000-0000-000000000002', '${T}', 'SCM-2024',   'Smart City Mission',      'css', '100',   100000000000, 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheme.project_scheme_components (id, scheme_id, tenant_id, code, name, allocation_minor, currency, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('44444444-0001-0000-0000-000000000009', '44444444-0001-0000-0000-000000000001', '${T}', 'ROADS', 'Road Construction',      40000000000, 'INR', now(), now(), '${A}', '${A}', 1),
  ('44444444-0001-0000-0000-000000000010', '44444444-0001-0000-0000-000000000002', '${T}', 'SMART', 'Smart Infrastructure', 80000000000,  'INR', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project.project_projects (id, tenant_id, code, name, scheme_id, dpr_cost_minor, sanctioned_minor, currency, status, start_date, end_date, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('44444444-0001-0000-0000-000000000003', '${T}', 'PROJ/2024/001', 'NH-48 Widening Phase 1', '44444444-0001-0000-0000-000000000001', 5000000000, 4800000000, 'INR', 'active',  '2024-04-01', '2025-09-30', now(), now(), '${A}', '${A}', 1),
  ('44444444-0001-0000-0000-000000000004', '${T}', 'PROJ/2024/002', 'Smart Traffic System',    '44444444-0001-0000-0000-000000000002', 1000000000, 950000000,  'INR', 'planned', '2024-07-01', '2025-06-30', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project.project_milestones (id, project_id, tenant_id, name, planned_date, payment_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('44444444-0001-0000-0000-000000000005', '44444444-0001-0000-0000-000000000003', '${T}', 'Land acquisition', '2024-06-30', 500000000, 'INR', 'completed',  now(), now(), '${A}', '${A}', 1),
  ('44444444-0001-0000-0000-000000000006', '44444444-0001-0000-0000-000000000003', '${T}', 'Foundation work',  '2024-12-31', 1000000000, 'INR', 'pending',   now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheme.project_fund_releases (id, scheme_id, component_id, tenant_id, release_no, amount_minor, currency, to_entity, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('44444444-0001-0000-0000-000000000007', '44444444-0001-0000-0000-000000000001', '44444444-0001-0000-0000-000000000009', '${T}', 'FR/2024/001', 1500000000, 'INR', 'agency', 'approved', now(), now(), '${A}', '${A}', 1),
  ('44444444-0001-0000-0000-000000000008', '44444444-0001-0000-0000-000000000002', '44444444-0001-0000-0000-000000000010', '${T}', 'FR/2024/002', 250000000,  'INR', 'agency', 'pending',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== grant-service ===");
// schemes: NO ministry/eligibility_summary/total_outlay_minor; has budget_minor, min/max_amount_minor
// beneficiaries: NO scheme_id/aadhaar_token/mobile/bank; has type, income_annual_minor, currency
// disbursements: need grant_installments first (installment_id required)
seed("civitas_grant", "schemes+beneficiaries+applications+installments+disbursements", `
INSERT INTO scheme.grant_schemes (id, tenant_id, code, name, budget_minor, min_amount_minor, max_amount_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0001-0000-0000-000000000001', '${T}', 'PMAYG', 'PM Awas Yojana Grameen', 250000000000, 0, 130000, 'INR', 'active', now(), now(), '${A}', '${A}', 1),
  ('55555555-0001-0000-0000-000000000002', '${T}', 'PMKSN', 'PM Kisan Samman Nidhi',  75000000000,  0, 6000,   'INR', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO beneficiary.grant_beneficiaries (id, tenant_id, name, type, income_annual_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0001-0000-0000-000000000003', '${T}', 'Ram Prasad',    'individual', 180000, 'INR', 'active', now(), now(), '${A}', '${A}', 1),
  ('55555555-0001-0000-0000-000000000004', '${T}', 'Savita Kumari', 'individual', 150000, 'INR', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO application.grant_applications (id, tenant_id, grant_no, scheme_id, beneficiary_id, purpose, amount_requested_minor, amount_approved_minor, currency, status, submitted_at, approved_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0001-0000-0000-000000000005', '${T}', 'GAPP/2024/001', '55555555-0001-0000-0000-000000000001', '55555555-0001-0000-0000-000000000003', 'Housing construction', 120000, 120000, 'INR', 'approved',  now(), now(), now(), now(), '${A}', '${A}', 1),
  ('55555555-0001-0000-0000-000000000006', '${T}', 'GAPP/2024/002', '55555555-0001-0000-0000-000000000001', '55555555-0001-0000-0000-000000000004', 'Housing construction', 120000, 0,      'INR', 'submitted', now(), null, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO disbursement.grant_installments (id, tenant_id, application_id, installment_no, amount_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0001-0000-0000-000000000007', '${T}', '55555555-0001-0000-0000-000000000005', 1, 60000, 'INR', 'disbursed', now(), now(), '${A}', '${A}', 1),
  ('55555555-0001-0000-0000-000000000008', '${T}', '55555555-0001-0000-0000-000000000005', 2, 60000, 'INR', 'pending',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO disbursement.grant_disbursements (id, tenant_id, installment_id, amount_minor, currency, mode, pfms_txn_id, status, disbursed_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0001-0000-0000-000000000009', '${T}', '55555555-0001-0000-0000-000000000007', 60000, 'INR', 'PFMS', 'PFMS/2024/0001', 'completed', now(), now(), now(), '${A}', '${A}', 1),
  ('55555555-0001-0000-0000-000000000010', '${T}', '55555555-0001-0000-0000-000000000008', 60000, 'INR', 'PFMS', 'PFMS/2024/0002', 'initiated', null, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO UPDATE SET pfms_txn_id = EXCLUDED.pfms_txn_id, status = EXCLUDED.status;

INSERT INTO utilisation.grant_uc_statements (id, tenant_id, application_id, period, released_minor, utilised_minor, variance_minor, currency, status, submitted_at, uc_ref, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0001-0000-0000-000000000011', '${T}', '55555555-0001-0000-0000-000000000005', '2024-25', 120000, 60000, 60000, 'INR', 'accepted', now(), 'UC/GRANT/2024/001', now(), now(), '${A}', '${A}', 1),
  ('55555555-0001-0000-0000-000000000012', '${T}', '55555555-0001-0000-0000-000000000005', '2023-24', 60000,  60000, 0,     'INR', 'submitted', now(), null,                now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== estab-service ===");
// files: dept(not department), priority(NOT NULL), classification(NOT NULL), current_with(uuid NOT NULL)
seed("civitas_estab", "files+committees+meetings+vehicles", `
INSERT INTO files.estab_files (id, tenant_id, file_no, subject, dept, priority, classification, current_with, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000001', '${T}', 'F/2024/001', 'Budget allocation request',      'ADMIN', 'normal', 'public', '${A}', 'active', now(), now(), '${A}', '${A}', 1),
  ('66666666-0001-0000-0000-000000000002', '${T}', 'F/2024/002', 'Tender approval for road works', 'PWD',   'high',   'public', '${A}', 'closed', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO committee.estab_committees (id, tenant_id, name, purpose, chair_ref, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000003', '${T}', 'Tender Evaluation Committee', 'Evaluate and approve tenders above 10L', '${A}', 'active', now(), now(), '${A}', '${A}', 1),
  ('66666666-0001-0000-0000-000000000004', '${T}', 'Works Advisory Committee',    'Advise on civil works',                   '${A}', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO committee.estab_meetings (id, tenant_id, committee_id, title, when_at, venue, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000005', '${T}', '66666666-0001-0000-0000-000000000003', 'Approval of 3 tenders',  now() + interval '7 days', 'Conference Room A', 'scheduled', now(), now(), '${A}', '${A}', 1),
  ('66666666-0001-0000-0000-000000000006', '${T}', '66666666-0001-0000-0000-000000000004', 'Review of ongoing works', now() - interval '3 days', 'Main Hall',         'completed', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO assets.estab_vehicles (id, tenant_id, reg_no, make_model, fuel_type, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000007', '${T}', 'DL01AB1234', 'Toyota Innova',      'petrol', 'available', now(), now(), '${A}', '${A}', 1),
  ('66666666-0001-0000-0000-000000000008', '${T}', 'DL01CD5678', 'Maruti Swift Dzire', 'cng',    'available', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF to_regclass('committee.estab_compliance') IS NOT NULL THEN
    INSERT INTO committee.estab_compliance (id, tenant_id, compliance_code, title, category, frequency, due_date, assigned_to, status, last_complied_date, remarks, created_at, updated_at, created_by, updated_by, version)
    VALUES
      ('66666666-0001-0000-0000-000000000009', '${T}', 'COMP/2024/001', 'Quarterly RTI compliance report', 'RTI Act', 'quarterly', '2025-03-31', '${A}', 'pending',  null, 'Pending submission to CIC', now(), now(), '${A}', '${A}', 1),
      ('66666666-0001-0000-0000-000000000010', '${T}', 'COMP/2024/002', 'Annual fire safety audit',        'Safety',  'annual',    '2025-04-30', '${A}', 'complied', '2024-04-15', 'Completed by PWD', now(), now(), '${A}', '${A}', 1)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

INSERT INTO facilities.estab_guesthouses (id, tenant_id, name, location, contact, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000011', '${T}', 'Secretariat Guest House', 'Block C, Secretariat Complex', '011-23456789', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO facilities.estab_rooms (id, tenant_id, guesthouse_id, room_no, type, capacity, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000012', '${T}', '66666666-0001-0000-0000-000000000011', '101', 'standard', 2, 'available', now(), now(), '${A}', '${A}', 1),
  ('66666666-0001-0000-0000-000000000013', '${T}', '66666666-0001-0000-0000-000000000011', '102', 'suite',    1, 'available', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO facilities.estab_room_bookings (id, tenant_id, room_id, guest_name, guest_ref, check_in, check_out, sponsor_dept, charges_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0001-0000-0000-000000000014', '${T}', '66666666-0001-0000-0000-000000000012', 'Dr. Meena Rao', '${A}', now() + interval '2 days', now() + interval '4 days', 'ADMIN', 0, 'INR', 'booked', now(), now(), '${A}', '${A}', 1),
  ('66666666-0001-0000-0000-000000000015', '${T}', '66666666-0001-0000-0000-000000000013', 'Sh. Arjun Singh', null, now() + interval '7 days', now() + interval '9 days', 'FIN', 500000, 'INR', 'booked', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== asset-service ===");
// categories: NO parent_id; has dep_rate(NOT NULL), dep_method(NOT NULL, 'SLM'|'WDV')
seed("civitas_asset", "categories+assets+maintenance_plans", `
INSERT INTO register.asset_categories (id, tenant_id, code, name, useful_life_years, dep_rate, dep_method, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('77777777-0001-0000-0000-000000000001', '${T}', 'IT', 'IT Equipment',        5,  20.0, 'SLM', now(), now(), '${A}', '${A}', 1),
  ('77777777-0001-0000-0000-000000000002', '${T}', 'FF', 'Furniture & Fixtures', 10, 10.0, 'SLM', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO register.asset_assets (id, tenant_id, code, name, category_id, acquisition_cost, currency, acquisition_date, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('77777777-0001-0000-0000-000000000003', '${T}', 'AST/2024/001', 'Dell Laptop XPS15',          '77777777-0001-0000-0000-000000000001', 9000000, 'INR', '2024-04-01', 'active', now(), now(), '${A}', '${A}', 1),
  ('77777777-0001-0000-0000-000000000004', '${T}', 'AST/2024/002', 'Conference Table 12-Seater', '77777777-0001-0000-0000-000000000002', 5000000, 'INR', '2024-04-01', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO maintenance.asset_maintenance_plans (id, tenant_id, asset_id, frequency, next_due, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('77777777-0001-0000-0000-000000000005', '${T}', '77777777-0001-0000-0000-000000000003', 'annual',    '2025-04-01', 'scheduled', now(), now(), '${A}', '${A}', 1),
  ('77777777-0001-0000-0000-000000000006', '${T}', '77777777-0001-0000-0000-000000000004', 'bi_annual', '2025-01-01', 'scheduled', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== stock-service ===");
// uoms: delete old-UUID rows that conflict on UNIQUE(tenant_id, symbol)
seed("civitas_stock", "uoms+categories+items+warehouses+ledger", `
DELETE FROM item.stock_uoms WHERE tenant_id = '${T}' AND symbol IN ('Nos', 'Kg');

INSERT INTO item.stock_uoms (id, tenant_id, name, symbol, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('88888888-0001-0000-0000-000000000001', '${T}', 'Number',   'Nos', now(), now(), '${A}', '${A}', 1),
  ('88888888-0001-0000-0000-000000000002', '${T}', 'Kilogram', 'Kg',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

DELETE FROM item.stock_item_categories WHERE tenant_id = '${T}' AND code IN ('STAT', 'CLEAN');

INSERT INTO item.stock_item_categories (id, tenant_id, name, code, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('88888888-0001-0000-0000-000000000003', '${T}', 'Stationery',        'STAT',  now(), now(), '${A}', '${A}', 1),
  ('88888888-0001-0000-0000-000000000004', '${T}', 'Cleaning Supplies', 'CLEAN', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO item.stock_items (id, tenant_id, code, name, category_id, uom_id, reorder_level, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('88888888-0001-0000-0000-000000000005', '${T}', 'STK001', 'A4 Paper Ream',  '88888888-0001-0000-0000-000000000003', '88888888-0001-0000-0000-000000000001', 20,  now(), now(), '${A}', '${A}', 1),
  ('88888888-0001-0000-0000-000000000006', '${T}', 'STK002', 'Ball Point Pen', '88888888-0001-0000-0000-000000000003', '88888888-0001-0000-0000-000000000001', 100, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouse.stock_warehouses (id, tenant_id, code, name, address, is_active, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('88888888-0001-0000-0000-000000000007', '${T}', 'WH01', 'Main Store',  'Block A, Secretariat Complex', true, now(), now(), '${A}', '${A}', 1),
  ('88888888-0001-0000-0000-000000000008', '${T}', 'WH02', 'Field Store', 'Field Office Sector 14',       true, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger.stock_ledger (id, tenant_id, item_id, warehouse_id, entry_id, voucher_type, qty_in, balance_qty, posting_date, created_at, created_by)
VALUES
  ('88888888-0001-0000-0000-000000000009', '${T}', '88888888-0001-0000-0000-000000000005', '88888888-0001-0000-0000-000000000007', '88888888-0001-0001-0000-000000000009', 'receipt', 50,  50,  now()::date, now(), '${A}'),
  ('88888888-0001-0000-0000-000000000010', '${T}', '88888888-0001-0000-0000-000000000006', '88888888-0001-0000-0000-000000000007', '88888888-0001-0001-0000-000000000010', 'receipt', 200, 200, now()::date, now(), '${A}')
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== audit-service ===");
// events: type, actor(jsonb), target, payload(jsonb), severity, occurred_at, created_at, created_by
// audit_plans: plan_no, title, area(NOT NULL), period_from(date), period_to(date), risk_level, status
// observations: obs_no, plan_id, auditee_ref(NOT NULL), finding(NOT NULL), category, risk_level, amount_involved_minor
seed("civitas_audit", "events+plans+observations", `
INSERT INTO events.events (id, tenant_id, type, actor, target, payload, severity, occurred_at, created_at, created_by)
VALUES
  ('99999999-0001-0000-0000-000000000001', '${T}', 'budget.sanctioned', '{"id":"${A}","name":"Demo Admin"}', 'finance_sanction:dddddddd-0001-0000-0000-000000000005', '{"amount": 50000000}',      'info', now(), now(), '${A}'),
  ('99999999-0001-0000-0000-000000000002', '${T}', 'po.created',        '{"id":"${A}","name":"Demo Admin"}', 'procurement_po:11111111-0002-0000-0000-000000000003',   '{"vendor": "TechSupplies"}', 'info', now(), now(), '${A}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plan.audit_plans (id, tenant_id, plan_no, title, area, period_from, period_to, risk_level, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0001-0000-0000-000000000003', '${T}', 'AP/2024/001', 'Annual Audit Plan 2024-25', 'Finance & Accounts',     '2024-04-01', '2025-03-31', 'high',   'approved',    now(), now(), '${A}', '${A}', 1),
  ('99999999-0001-0000-0000-000000000004', '${T}', 'AP/2024/002', 'Revenue Audit Q2 2024',     'Revenue Administration', '2024-07-01', '2024-09-30', 'medium', 'in_progress', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO observation.audit_observations (id, tenant_id, obs_no, plan_id, auditee_ref, finding, category, risk_level, amount_involved_minor, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0001-0000-0000-000000000005', '${T}', 'OBS/2024/001', '99999999-0001-0000-0000-000000000003', 'Finance Dept', 'Budget overrun in dept XYZ — excess spending of Rs 5L',         'compliance', 'high',   500000, 'open',          now(), now(), '${A}', '${A}', 1),
  ('99999999-0001-0000-0000-000000000006', '${T}', 'OBS/2024/002', '99999999-0001-0000-0000-000000000003', 'Admin Dept',   'Missing procurement documentation for PO/2024/001',             'compliance', 'medium', 0,      'pending_reply',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plan.audit_plan_items (id, tenant_id, plan_id, dept_ref, unit_ref, scheduled_from, scheduled_to, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0001-0000-0000-000000000021', '${T}', '99999999-0001-0000-0000-000000000003', 'Finance Dept',     'Accounts Unit',  '2024-04-01', '2024-06-30', 'planned',     now(), now(), '${A}', '${A}', 1),
  ('99999999-0001-0000-0000-000000000022', '${T}', '99999999-0001-0000-0000-000000000004', 'Revenue Dept',     'Tax Assessment', '2024-07-01', '2024-09-30', 'in_progress', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO risk.audit_risks (id, tenant_id, risk_code, title, category, likelihood, impact, risk_score, owner_ref, mitigation_status, review_date, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0001-0000-0000-000000000031', '${T}', 'RISK/2024/001', 'Budget overspend without sanction', 'financial',    'likely',          'major',      16, 'Finance Head', 'in_progress', '2025-03-31', 'open', now(), now(), '${A}', '${A}', 1),
  ('99999999-0001-0000-0000-000000000032', '${T}', 'RISK/2024/002', 'Delayed vendor payments',           'operational',  'possible',        'moderate',   9,  'Accounts Officer', 'not_started', '2025-06-30', 'open', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exports.exports (id, tenant_id, period_from, period_to, format, signed_url, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0001-0000-0000-000000000041', '${T}', '2024-04-01', '2024-09-30', 'pdf',  'https://exports.demo.gov.in/audit-q2.pdf',  'completed', now(), now(), '${A}', '${A}', 1),
  ('99999999-0001-0000-0000-000000000042', '${T}', '2024-10-01', '2024-12-31', 'xlsx', null,                                         'pending',   now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO compliance.audit_pending_register (id, tenant_id, para_id, dept_ref, amount_involved_minor, status, due_date, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0001-0000-0000-000000000051', '${T}', '99999999-0001-0000-0000-000000000005', 'Finance Dept', 500000, 'pending',  '2025-03-31', now(), now(), '${A}', '${A}', 1),
  ('99999999-0001-0000-0000-000000000052', '${T}', '99999999-0001-0000-0000-000000000006', 'Admin Dept',   0,        'pending',  '2025-04-30', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== legal-service ===");
// case_types: NO court_type (just code, name)
// cases: NO filed_date; has court(NOT NULL), subject, petitioner, status, next_date
// hearings: hearing_date(date), court(NOT NULL), purpose, status
// notices: notice_no, subject, party_ref(NOT NULL), direction(NOT NULL), status
seed("civitas_legal", "case_types+cases+hearings+notices", `
INSERT INTO cases.legal_case_types (id, tenant_id, code, name, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000001', '${T}', 'WP', 'Writ Petition', now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0002-0000-0000-000000000002', '${T}', 'CS', 'Civil Suit',    now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cases.legal_cases (id, tenant_id, case_no, title, court, subject, case_type_id, petitioner, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000003', '${T}', 'WP/12345/2024', 'M/s ABC Builders vs State Govt', 'Delhi High Court',       'Tender cancellation challenge', 'aaaaaaaa-0002-0000-0000-000000000001', 'M/s ABC Builders', 'pending',     now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0002-0000-0000-000000000004', '${T}', 'CS/5678/2024',  'Land acquisition dispute',        'District Court Gurgaon', 'Compensation dispute',          'aaaaaaaa-0002-0000-0000-000000000002', 'Rajesh Sharma',    'pending',     now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO hearings.legal_hearings (id, tenant_id, case_id, hearing_date, court, purpose, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000005', '${T}', 'aaaaaaaa-0002-0000-0000-000000000003', (now() + interval '14 days')::date, 'Delhi High Court',       'Arguments hearing',  'scheduled', now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0002-0000-0000-000000000006', '${T}', 'aaaaaaaa-0002-0000-0000-000000000004', (now() + interval '7 days')::date,  'District Court Gurgaon', 'Evidence recording', 'scheduled', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notices.legal_notices (id, tenant_id, notice_no, subject, party_ref, direction, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000007', '${T}', 'LN/2024/001', 'Land acquisition notice', 'Ram Prasad',      'sent', 'open',    now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0002-0000-0000-000000000008', '${T}', 'LN/2024/002', 'Show cause notice',        'XYZ Contractors', 'sent', 'pending', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF to_regclass('hearings.legal_opinions') IS NOT NULL THEN
    INSERT INTO hearings.legal_opinions (id, tenant_id, opinion_no, subject, requested_by, request_date, due_date, advisor_name, status, issued_date, created_at, updated_at, created_by, updated_by, version)
    VALUES
      ('aaaaaaaa-0002-0000-0000-000000000009', '${T}', 'LO/2024/001', 'Validity of tender cancellation', 'Finance Dept', '2024-10-01', '2024-11-01', 'Legal Advisor', 'issued',  '2024-10-28', now(), now(), '${A}', '${A}', 1),
      ('aaaaaaaa-0002-0000-0000-000000000010', '${T}', 'LO/2024/002', 'Land compensation liability',     'Revenue Dept', '2024-11-15', '2024-12-15', 'Panel Counsel', 'pending', null,         now(), now(), '${A}', '${A}', 1)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

INSERT INTO hearings.legal_orders (id, tenant_id, case_id, order_type, direction, dept_ref, summary, order_date, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0002-0000-0000-000000000011', '${T}', 'aaaaaaaa-0002-0000-0000-000000000003', 'interim', 'Stay tender cancellation pending hearing', 'PWD', 'Interim stay granted on tender TND/2024/001', '2024-09-15', now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0002-0000-0000-000000000012', '${T}', 'aaaaaaaa-0002-0000-0000-000000000004', 'final',   'Enhance compensation by 15%',              'Revenue', 'Court directs revised compensation award',    '2024-08-20', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== admin-service ===");
// admin_tenants: same schema as tenant.tenants
// admin_feature_flags: NO description column; has overrides(jsonb)
// admin_module_configs: NO config column; has enabled(boolean)
seed("civitas_admin", "tenants+feature_flags+module_configs", `
INSERT INTO tenants.admin_tenants (id, tenant_id, name, domain, edition, status, region, residency, settings, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('${T}',  '${T}',  'Demo Government Dept', 'demo-govt.civitasone.in', 'govt_dept', 'active', 'ap-south-1', 'in', '{}', now(), now(), '${A}', '${A}', 1),
  ('${T2}', '${T2}', 'Test PSU Office',       'test-psu.civitasone.in',  'psu',       'active', 'ap-south-1', 'in', '{}', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO config.admin_feature_flags (id, tenant_id, flag_key, enabled, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('bbbbbbbb-0002-0000-0000-000000000001', '${T}', 'analytics_enabled',  true, now(), now(), '${A}', '${A}', 1),
  ('bbbbbbbb-0002-0000-0000-000000000002', '${T}', 'mobile_app_enabled', true, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO config.admin_module_configs (id, tenant_id, module_key, enabled, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('bbbbbbbb-0002-0000-0000-000000000003', '${T}', 'finance', true, now(), now(), '${A}', '${A}', 1),
  ('bbbbbbbb-0002-0000-0000-000000000004', '${T}', 'hrms',    true, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF to_regclass('api_keys.admin_api_keys') IS NOT NULL THEN
    INSERT INTO api_keys.admin_api_keys (id, tenant_id, key_name, key_prefix, key_hash, scopes, status, created_at, updated_at, created_by, updated_by, version)
    VALUES
      ('bbbbbbbb-0003-0000-0000-000000000001', '${T}', 'Integration Gateway Key', 'civ_live', 'sha256:seed-demo-hash-001', ARRAY['read','write'], 'active', now(), now(), '${A}', '${A}', 1),
      ('bbbbbbbb-0003-0000-0000-000000000002', '${T}', 'Reporting Export Key',    'civ_rpt',  'sha256:seed-demo-hash-002', ARRAY['read'],         'active', now(), now(), '${A}', '${A}', 1)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

INSERT INTO support.admin_break_glass_log (id, tenant_id, ticket_id, actor_id, reason, opened_at, expires_at, closed_at, correlation_id, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('bbbbbbbb-0004-0000-0000-000000000001', '${T}', 'bbbbbbbb-0004-0000-0000-000000000099', '${A}', 'Emergency access to finance sanctions during outage', now() - interval '2 hours', now() + interval '1 hour', now() - interval '30 minutes', 'seed-breakglass-001', now(), now(), '${A}', '${A}', 1),
  ('bbbbbbbb-0004-0000-0000-000000000002', '${T}', 'bbbbbbbb-0004-0000-0000-000000000099', '${A}', 'Support ticket escalation — read-only tenant audit', now() - interval '30 minutes', now() + interval '2 hours', null, 'seed-breakglass-002', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== billing-service ===");
// plans: NO description/billing_cycle/status; has govt_exempt, active(boolean)
// subscriptions: started_at (not starts_at), UNIQUE(tenant_id)
// invoices: period_month(char 7), total_minor; NO subscription_id/invoice_no/amount_minor/due_date
seed("civitas_billing", "plans+subscriptions+invoices", `
INSERT INTO plans.billing_plans (id, tenant_id, name, code, price_minor, currency, govt_exempt, active, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('cccccccc-0002-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'Government Plan', 'GOVT', 500000, 'INR', true,  true, now(), now(), '${A}', '${A}', 1),
  ('cccccccc-0002-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'PSU Plan',        'PSU',  300000, 'INR', false, true, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscriptions.billing_subscriptions (id, tenant_id, plan_id, status, started_at, ends_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('cccccccc-0002-0000-0000-000000000003', '${T}',  'cccccccc-0002-0000-0000-000000000001', 'active', '2024-04-01', '2025-03-31', now(), now(), '${A}', '${A}', 1),
  ('cccccccc-0002-0000-0000-000000000004', '${T2}', 'cccccccc-0002-0000-0000-000000000002', 'active', '2024-04-01', '2025-03-31', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices.billing_invoices (id, tenant_id, period_month, status, total_minor, currency, issued_at, paid_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('cccccccc-0002-0000-0000-000000000005', '${T}',  '2024-04', 'paid',  500000, 'INR', now(), now(), now(), now(), '${A}', '${A}', 1),
  ('cccccccc-0002-0000-0000-000000000006', '${T2}', '2024-04', 'draft', 300000, 'INR', null,  null, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== notification-service ===");
// deliveries: status CHECK: queued|sending|delivered|failed|skipped (NOT 'sent')
seed("civitas_notification", "templates+deliveries", `
INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0002-0000-0000-000000000001', '${T}', 'email', 'Bill Approval',   'Bill #{bill_no} approval required', 'Dear {{name}}, bill {{bill_no}} requires your approval.', 'active', now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0002-0000-0000-000000000002', '${T}', 'sms',   'Leave Status SMS', null,                                'Your leave for {{dates}} has been {{status}}.',            'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO deliveries.deliveries (id, tenant_id, template_id, recipient, channel, status, sent_at, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0002-0000-0000-000000000003', '${T}', 'dddddddd-0002-0000-0000-000000000001', 'finance@demo.gov.in', 'email', 'delivered', now(), now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0002-0000-0000-000000000004', '${T}', 'dddddddd-0002-0000-0000-000000000002', '9876541001',          'sms',   'delivered', now(), now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO templates.prefs (id, tenant_id, user_id, event_type, in_app, email, push, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('dddddddd-0003-0000-0000-000000000001', '${T}', '${A}', 'bill.approved',  true,  true,  false, now(), now(), '${A}', '${A}', 1),
  ('dddddddd-0003-0000-0000-000000000002', '${T}', '${A}', 'leave.approved', true,  false, false, now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== crm-service ===");
// activities: NO version/updated_at/updated_by (only id, tenant_id, actor_name, text, created_at, created_by)
seed("civitas_crm", "contacts+deals+activities", `
INSERT INTO crm.contacts (id, tenant_id, name, email, phone, company, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0002-0000-0000-000000000001', '${T}', 'Rajesh Gupta', 'rajesh@techcorp.in',   '9900001111', 'TechCorp Solutions', 'active', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0002-0000-0000-000000000002', '${T}', 'Kavita Singh', 'kavita@infraworks.in', '9900002222', 'InfraWorks Ltd',     'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('eeeeeeee-0002-0000-0000-000000000003', '${T}', 'Smart City Sensors',        'Proposal',    25000000, 'INR', 'active', now(), now(), '${A}', '${A}', 1),
  ('eeeeeeee-0002-0000-0000-000000000004', '${T}', 'IT Infrastructure Upgrade', 'Negotiation', 80000000, 'INR', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm.activities (id, tenant_id, actor_name, text, created_at, created_by)
VALUES
  ('eeeeeeee-0002-0000-0000-000000000005', '${T}', 'Demo Admin', 'Initial meeting with vendor for smart city sensors', now(), '${A}'),
  ('eeeeeeee-0002-0000-0000-000000000006', '${T}', 'Demo Admin', 'Proposal submitted for IT infrastructure upgrade',   now(), '${A}')
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== knowledge-service ===");
seed("civitas_knowledge", "documents", `
INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('ffffffff-0002-0000-0000-000000000001', '${T}', 'Financial Management Manual 2024', 'finance',     'published', now(), now(), '${A}', '${A}', 1),
  ('ffffffff-0002-0000-0000-000000000002', '${T}', 'Procurement Guidelines GFR 2017',  'procurement', 'published', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== workflow-service ===");
seed("civitas_workflow", "instances+tasks", `
INSERT INTO workflow.instances (id, tenant_id, name, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0003-0000-0000-000000000001', '${T}', 'Budget Approval Workflow', 'active', now(), now(), '${A}', '${A}', 1),
  ('11111111-0003-0000-0000-000000000002', '${T}', 'Leave Approval Workflow',  'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('11111111-0003-0000-0000-000000000003', '${T}', '11111111-0003-0000-0000-000000000001', 'Dept Head Approval',       'completed', now(), now(), '${A}', '${A}', 1),
  ('11111111-0003-0000-0000-000000000004', '${T}', '11111111-0003-0000-0000-000000000001', 'Finance Officer Approval', 'pending',   now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== analytics-service ===");
seed("civitas_analytics", "dashboards+query_runs", `
INSERT INTO analytics.dashboards (id, tenant_id, name, description, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('22222222-0003-0000-0000-000000000001', '${T}', 'Finance Overview', 'Monthly finance KPIs',         'active', now(), now(), '${A}', '${A}', 1),
  ('22222222-0003-0000-0000-000000000002', '${T}', 'HR Dashboard',     'Employee headcount analytics', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO analytics.query_runs (id, tenant_id, dashboard_id, query_name, status, result_rows, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('22222222-0003-0000-0000-000000000003', '${T}', '22222222-0003-0000-0000-000000000001', 'budget_summary',    'completed', 10, now(), now(), '${A}', '${A}', 1),
  ('22222222-0003-0000-0000-000000000004', '${T}', '22222222-0003-0000-0000-000000000002', 'headcount_by_dept', 'completed', 5,  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== report-service ===");
// schema is reports.jobs (not report.jobs)
seed("civitas_report", "jobs+kpis", `
INSERT INTO reports.jobs (id, tenant_id, name, report_type, status, format, row_count, requested_by, completed_at, download_url, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0003-0000-0000-000000000001', '${T}', 'Monthly Budget Report Dec 2024', 'budget_summary',  'completed', 'pdf',  42, '${A}', now(), 'https://reports.demo.gov.in/budget-dec-2024.pdf', now(), now(), '${A}', '${A}', 1),
  ('33333333-0003-0000-0000-000000000002', '${T}', 'Vendor Payment Report Q3',       'payment_summary', 'completed', 'xlsx', 18, '${A}', now(), 'https://reports.demo.gov.in/payments-q3.xlsx',    now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO reports.kpis (id, tenant_id, kpi_name, module, target_value, current_value, unit, period, trend, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('33333333-0003-0000-0000-000000000003', '${T}', 'Budget Utilisation',  'finance',     100, 87.5,  '%',  '2024-25', 'up',     'on_track', now(), now(), '${A}', '${A}', 1),
  ('33333333-0003-0000-0000-000000000004', '${T}', 'Pending Sanctions',   'finance',     10,  3,     'count','2024-25', 'down',   'on_track', now(), now(), '${A}', '${A}', 1),
  ('33333333-0003-0000-0000-000000000005', '${T}', 'Employee Headcount',  'hr',          500, 482,   'count','2024-25', 'stable', 'on_track', now(), now(), '${A}', '${A}', 1),
  ('33333333-0003-0000-0000-000000000006', '${T}', 'Open Audit Observations', 'audit',   20,  8,     'count','2024-25', 'down',   'at_risk',  now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== helpdesk-service ===");
seed("civitas_helpdesk", "tickets", `
INSERT INTO helpdesk.tickets (id, tenant_id, subject, description, priority, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('44444444-0003-0000-0000-000000000001', '${T}', 'Cannot login to portal',    'Getting 401 error on login',    'High',   'open',        now(), now(), '${A}', '${A}', 1),
  ('44444444-0003-0000-0000-000000000002', '${T}', 'Report export not working', 'PDF export button does nothing', 'Medium', 'in_progress', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== inventory-service ===");
seed("civitas_inventory", "items", `
INSERT INTO inventory.items (id, tenant_id, name, sku, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('55555555-0003-0000-0000-000000000001', '${T}', 'Laptop HP ProBook',       'HP-PB-001', 'active', now(), now(), '${A}', '${A}', 1),
  ('55555555-0003-0000-0000-000000000002', '${T}', 'Wireless Mouse Logitech', 'LG-WM-001', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== location-service ===");
seed("civitas_location", "locations", `
INSERT INTO location.locations (id, tenant_id, name, address_line, city, postal_code, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('66666666-0003-0000-0000-000000000001', '${T}', 'Secretariat HQ',          'Secretariat Complex, Rajpath', 'New Delhi', '110001', 'active', now(), now(), '${A}', '${A}', 1),
  ('66666666-0003-0000-0000-000000000002', '${T}', 'District Office Gurugram', 'Mini Secretariat, Sector 12', 'Gurugram',  '122001', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== theme-service ===");
seed("civitas_theme", "tokens", `
INSERT INTO theme.tokens (id, tenant_id, name, value, category, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('77777777-0003-0000-0000-000000000001', '${T}', '--color-primary', '#1a56db', 'color', 'active', now(), now(), '${A}', '${A}', 1),
  ('77777777-0003-0000-0000-000000000002', '${T}', '--color-accent',  '#f59e0b', 'color', 'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== plugin-service ===");
seed("civitas_plugin", "items", `
INSERT INTO plugin.items (id, tenant_id, name, semver, description, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('88888888-0003-0000-0000-000000000001', '${T}', 'GST Filing Plugin',   '1.2.0', 'Auto-generate GST returns from billing data', 'active', now(), now(), '${A}', '${A}', 1),
  ('88888888-0003-0000-0000-000000000002', '${T}', 'Aadhaar eKYC Plugin', '2.0.1', 'Citizen verification via Aadhaar OTP',        'active', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== telephony-service ===");
seed("civitas_telephony", "calls", `
INSERT INTO telephony.calls (id, tenant_id, name, caller_number, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('99999999-0003-0000-0000-000000000001', '${T}', 'Citizen Helpline Call', '9876500001', 'completed', now(), now(), '${A}', '${A}', 1),
  ('99999999-0003-0000-0000-000000000002', '${T}', 'Support Call',          '9876500002', 'active',    now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== install-service ===");
seed("civitas_install", "stages", `
INSERT INTO install.stages (id, tenant_id, name, step_number, description, status, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('aaaaaaaa-0003-0000-0000-000000000001', '${T}', 'Database Setup',      1, 'Create databases and apply migrations', 'completed', now(), now(), '${A}', '${A}', 1),
  ('aaaaaaaa-0003-0000-0000-000000000002', '${T}', 'Admin Configuration', 2, 'Configure admin tenant and features',   'completed', now(), now(), '${A}', '${A}', 1)
ON CONFLICT (id) DO NOTHING;
`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Seed summary ─────────────────────────");
console.log(`Batches seeded : ${seeded}`);
console.log(`Errors         : ${errors}`);
console.log(`Tenant         : ${T}`);
console.log(`Actor          : ${A}`);
if (errors > 0) {
  console.error("Some batches had errors — check output above.");
  process.exit(1);
}
console.log("Done.");
