-- ════════════════════════════════════════════════════════════════════════
-- CivitasOne HRMS — Master Data Seed
-- Designations (Govt of India cadre), Departments, Pay Levels (7th CPC)
-- ════════════════════════════════════════════════════════════════════════
-- Run: PGPASSWORD=civitas_dev_pw psql -h localhost -p 5435 -U civitas_admin -d civitas_hrms -f scripts/seed-hrms-master-data.sql

-- Use the existing tenant
\set tenant_id '1ebadb1c-f10d-40d8-9bd8-1a14a436705b'

-- ═══════════════════════════════════════════════════════════════════════
-- DESIGNATIONS (Government of India — standard cadre)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO employee.hrms_designations (id, name, tenant_id, created_at, updated_at, version)
VALUES
-- Group A (IAS/IPS/IFS equivalent)
(gen_random_uuid(), 'Secretary to Government', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Additional Secretary', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Joint Secretary', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Director', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Deputy Secretary', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Under Secretary', :'tenant_id'::uuid, now(), now(), 1),
-- Group B (Gazetted)
(gen_random_uuid(), 'Section Officer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Assistant Section Officer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Private Secretary', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Accounts Officer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Administrative Officer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Senior Analyst', :'tenant_id'::uuid, now(), now(), 1),
-- Group B (Non-Gazetted)
(gen_random_uuid(), 'Assistant', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Stenographer Grade D', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Stenographer Grade C', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Personal Assistant', :'tenant_id'::uuid, now(), now(), 1),
-- Group C
(gen_random_uuid(), 'Upper Division Clerk (UDC)', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Lower Division Clerk (LDC)', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Data Entry Operator', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Junior Accountant', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Hindi Translator', :'tenant_id'::uuid, now(), now(), 1),
-- Technical
(gen_random_uuid(), 'Chief Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Superintending Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Executive Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Assistant Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Junior Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Senior Software Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Software Engineer', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'System Administrator', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Network Engineer', :'tenant_id'::uuid, now(), now(), 1),
-- Multi-Tasking Staff (Group D equivalent)
(gen_random_uuid(), 'Multi-Tasking Staff (MTS)', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Peon', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Driver', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Safai Karamchari', :'tenant_id'::uuid, now(), now(), 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- DEPARTMENTS (Standard Central Government)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO employee.hrms_departments (id, name, tenant_id, created_at, updated_at, version)
VALUES
(gen_random_uuid(), 'Administration', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Finance & Accounts', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Human Resources', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Information Technology', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Engineering', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Legal', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Procurement & Stores', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Planning & Statistics', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Vigilance', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Public Relations', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Establishment', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Audit & Internal Control', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Projects & Works', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'General Administration', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Hindi (Rajbhasha)', :'tenant_id'::uuid, now(), now(), 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- HOLIDAYS (Central Government — Gazetted 2025)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO leave.hrms_holidays (id, name, holiday_date, holiday_type, tenant_id, created_at, updated_at, version)
VALUES
(gen_random_uuid(), 'Republic Day', '2025-01-26', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Maha Shivaratri', '2025-02-26', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Holi', '2025-03-14', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Good Friday', '2025-04-18', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Dr. Ambedkar Jayanti', '2025-04-14', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'May Day', '2025-05-01', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Buddha Purnima', '2025-05-12', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Eid ul-Fitr', '2025-03-31', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Independence Day', '2025-08-15', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Janmashtami', '2025-08-16', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Mahatma Gandhi Jayanti', '2025-10-02', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Dussehra', '2025-10-02', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Diwali', '2025-10-20', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Guru Nanak Jayanti', '2025-11-05', 'gazetted', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Christmas Day', '2025-12-25', 'gazetted', :'tenant_id'::uuid, now(), now(), 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- LEAVE TYPES (CCS Leave Rules 1972)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO leave.hrms_leave_types (id, name, code, tenant_id, created_at, updated_at, version)
VALUES
(gen_random_uuid(), 'Casual Leave', 'CL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Earned Leave', 'EL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Half Pay Leave', 'HPL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Commuted Leave', 'COML', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Leave Not Due', 'LND', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Extraordinary Leave', 'EOL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Maternity Leave', 'ML', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Paternity Leave', 'PL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Child Care Leave', 'CCL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Study Leave', 'STL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Special Disability Leave', 'SDL', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Hospital Leave', 'HL', :'tenant_id'::uuid, now(), now(), 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SHIFTS (Standard Government working hours)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO attendance.hrms_shifts (id, name, start_time, end_time, tenant_id, created_at, updated_at, version)
VALUES
(gen_random_uuid(), 'General Shift (9:00–17:30)', '09:00', '17:30', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Flexible Timing (9:30–18:00)', '09:30', '18:00', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Morning Shift (7:00–15:00)', '07:00', '15:00', :'tenant_id'::uuid, now(), now(), 1),
(gen_random_uuid(), 'Night Shift (22:00–06:00)', '22:00', '06:00', :'tenant_id'::uuid, now(), now(), 1)
ON CONFLICT DO NOTHING;
