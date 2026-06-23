-- Migration 0006: World-class leave management
-- Adds: half-day, comp-off, encashment, leave-year config, location holidays,
-- optional holidays, approval matrix, auto-credit config, blackout dates, cancellation

-- ═══ Enhance leave_policy_rules with missing fields ═══
ALTER TABLE leave.hrms_leave_policy_rules
  ADD COLUMN IF NOT EXISTS allow_half_day BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_negative_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_days_between_applications INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_backdated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_backdate_days INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS accrual_method VARCHAR(16) NOT NULL DEFAULT 'annual',  -- annual | monthly | quarterly
  ADD COLUMN IF NOT EXISTS lapse_policy VARCHAR(16) NOT NULL DEFAULT 'lapse',    -- lapse | carry | encash
  ADD COLUMN IF NOT EXISTS lapse_max_carry_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_levels INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS l2_threshold_days INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS l3_threshold_days INT NOT NULL DEFAULT 15;

-- ═══ Leave Year Configuration (per tenant) ═══
CREATE TABLE IF NOT EXISTS leave.hrms_leave_year_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  year_start_month INT NOT NULL DEFAULT 1,   -- 1=Jan, 4=Apr (Indian FY)
  year_start_day INT NOT NULL DEFAULT 1,
  weekend_days VARCHAR(16) NOT NULL DEFAULT '0,6', -- 0=Sun, 6=Sat
  credit_day INT NOT NULL DEFAULT 1,          -- Day of month when EL credited
  lapse_run_month INT NOT NULL DEFAULT 12,    -- Month when lapse job runs
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO leave.hrms_leave_year_config (tenant_id, year_start_month, weekend_days) VALUES
  ('00000000-0000-0000-0000-000000000001', 1, '0,6')
ON CONFLICT (tenant_id) DO NOTHING;

-- ═══ Location-based Holidays ═══
ALTER TABLE leave.hrms_holidays
  ADD COLUMN IF NOT EXISTS location_id UUID,
  ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_optional_per_year INT NOT NULL DEFAULT 2;

-- ═══ Employee Optional Holiday Selections ═══
CREATE TABLE IF NOT EXISTS leave.hrms_holiday_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  holiday_id UUID NOT NULL REFERENCES leave.hrms_holidays(id),
  calendar_year INT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, holiday_id)
);

-- ═══ Comp-Off (Compensatory Off) Ledger ═══
CREATE TABLE IF NOT EXISTS leave.hrms_comp_off_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  worked_date DATE NOT NULL,
  reason VARCHAR(512) NOT NULL,
  days_earned NUMERIC(3,1) NOT NULL DEFAULT 1.0,  -- 0.5 or 1.0
  days_redeemed NUMERIC(3,1) NOT NULL DEFAULT 0,
  expires_at DATE NOT NULL,  -- typically worked_date + 30
  status VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed', 'expired', 'cancelled')),
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comp_off_emp ON leave.hrms_comp_off_ledger(tenant_id, employee_id, status);

-- ═══ Leave Encashment Records ═══
CREATE TABLE IF NOT EXISTS leave.hrms_leave_encashments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  leave_type_id UUID NOT NULL,
  days_encashed INT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  encashment_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  payroll_run_id UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

-- ═══ Blackout Dates (no leave allowed) ═══
CREATE TABLE IF NOT EXISTS leave.hrms_blackout_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason VARCHAR(512) NOT NULL,
  applies_to VARCHAR(32) NOT NULL DEFAULT 'all', -- all | department_id | employee_type
  applies_to_value VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blackout_tenant ON leave.hrms_blackout_dates(tenant_id, from_date, to_date);

-- ═══ Leave Cancellation Records ═══
ALTER TABLE leave.hrms_leave_apps
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS half_day_type VARCHAR(8);  -- 'first' | 'second'

-- ═══ Approval Matrix (configurable per leave type + threshold) ═══
CREATE TABLE IF NOT EXISTS leave.hrms_leave_approval_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  leave_type_id UUID,          -- NULL means applies to all types
  employee_type VARCHAR(32),    -- NULL means applies to all types
  min_days INT NOT NULL DEFAULT 1,
  max_days INT NOT NULL DEFAULT 999,
  level INT NOT NULL DEFAULT 1,
  approver_role VARCHAR(64) NOT NULL,  -- 'reporting_officer' | 'hod' | 'director' | 'hr_admin'
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

-- Seed approval matrix
INSERT INTO leave.hrms_leave_approval_matrix (tenant_id, employee_type, min_days, max_days, level, approver_role, created_by) VALUES
  ('00000000-0000-0000-0000-000000000001', 'permanent',     1, 3,   1, 'reporting_officer', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'permanent',     4, 15,  1, 'reporting_officer', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'permanent',     4, 15,  2, 'hod',               '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'permanent',     16, 999, 1, 'reporting_officer', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'permanent',     16, 999, 2, 'hod',               '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'permanent',     16, 999, 3, 'director',          '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'contractual',   1, 999,  1, 'reporting_officer', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'contractual',   1, 999,  2, 'hr_admin',          '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'vendor_deputed', 1, 999, 1, 'reporting_officer', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'vendor_deputed', 1, 999, 2, 'hr_admin',          '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

-- ═══ Add more holidays (location-specific + optional) ═══
INSERT INTO leave.hrms_holidays (tenant_id, name, date, type, is_optional, created_by) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Holi', '2026-03-17', 'gazetted', false, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Good Friday', '2026-04-03', 'gazetted', false, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Eid ul-Fitr', '2026-03-21', 'gazetted', false, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Mahavir Jayanti', '2026-04-06', 'restricted', true, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Buddha Purnima', '2026-05-12', 'restricted', true, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Guru Nanak Jayanti', '2026-11-08', 'restricted', true, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Milad-un-Nabi', '2026-09-17', 'restricted', true, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Onam', '2026-09-02', 'restricted', true, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Pongal', '2026-01-14', 'restricted', true, '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Chhath Puja', '2026-11-05', 'restricted', true, '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

