-- Migration 0009: Letter templates + Shift management + Full & Final

-- ═══ Letter Templates ═══
CREATE TABLE IF NOT EXISTS employee.hrms_letter_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  letter_type VARCHAR(32) NOT NULL CHECK (letter_type IN ('offer', 'appointment', 'confirmation', 'transfer', 'promotion', 'warning', 'suspension', 'relieving', 'experience', 'salary_revision', 'internship', 'apprenticeship')),
  name VARCHAR(256) NOT NULL,
  template_html TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  UNIQUE(tenant_id, letter_type, name)
);

-- ═══ Generated Letters (audit trail) ═══
CREATE TABLE IF NOT EXISTS employee.hrms_generated_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  template_id UUID NOT NULL,
  letter_type VARCHAR(32) NOT NULL,
  generated_html TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID NOT NULL,
  reference_no VARCHAR(64),
  effective_date DATE
);

-- ═══ Shift Master ═══
CREATE TABLE IF NOT EXISTS attendance.hrms_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(16) NOT NULL,
  start_time VARCHAR(5) NOT NULL, -- HH:MM
  end_time VARCHAR(5) NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 15,
  half_day_minutes INT NOT NULL DEFAULT 240, -- after 4 hours = half day
  overtime_threshold_minutes INT NOT NULL DEFAULT 30,
  is_night_shift BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  UNIQUE(tenant_id, code)
);

-- ═══ Shift Roster (employee-shift assignment) ═══
CREATE TABLE IF NOT EXISTS attendance.hrms_shift_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  shift_id UUID NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shift_roster_emp ON attendance.hrms_shift_roster(tenant_id, employee_id, is_active);

-- ═══ Overtime Records ═══
CREATE TABLE IF NOT EXISTS attendance.hrms_overtime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  regular_hours NUMERIC(4,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(4,2) NOT NULL DEFAULT 0,
  overtime_rate NUMERIC(3,1) NOT NULL DEFAULT 1.5, -- 1.5x or 2x
  approved_by UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

-- ═══ Full & Final Settlement ═══
CREATE TABLE IF NOT EXISTS employee.hrms_fnf_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  separation_date DATE NOT NULL,
  last_working_day DATE NOT NULL,
  notice_period_days INT NOT NULL DEFAULT 30,
  notice_served_days INT NOT NULL DEFAULT 0,
  notice_buyout_minor BIGINT NOT NULL DEFAULT 0,
  leave_encashment_days INT NOT NULL DEFAULT 0,
  leave_encashment_minor BIGINT NOT NULL DEFAULT 0,
  gratuity_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  gratuity_minor BIGINT NOT NULL DEFAULT 0,
  bonus_minor BIGINT NOT NULL DEFAULT 0,
  pending_reimbursements_minor BIGINT NOT NULL DEFAULT 0,
  recovery_loan_minor BIGINT NOT NULL DEFAULT 0,
  recovery_advance_minor BIGINT NOT NULL DEFAULT 0,
  recovery_assets TEXT, -- list of unreturned assets
  total_payable_minor BIGINT NOT NULL DEFAULT 0,
  total_recovery_minor BIGINT NOT NULL DEFAULT 0,
  net_settlement_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_clearance', 'hr_approved', 'finance_approved', 'paid', 'disputed')),
  approved_by UUID,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

-- ═══ Seed default letter templates ═══
INSERT INTO employee.hrms_letter_templates (tenant_id, letter_type, name, template_html, variables, is_default, created_by) VALUES
('00000000-0000-0000-0000-000000000001', 'offer', 'Standard Offer Letter', '<html><body><h2>Offer of Employment</h2><p>Dear {{candidateName}},</p><p>We are pleased to offer you the position of <b>{{designation}}</b> in the <b>{{department}}</b> department at <b>{{orgName}}</b>.</p><p>Your CTC will be <b>₹{{ctc}}</b> per annum. Your joining date is <b>{{joiningDate}}</b>.</p><p>Please confirm your acceptance within 7 days.</p><p>Regards,<br/>HR Department</p></body></html>', ''["candidateName","designation","department","orgName","ctc","joiningDate"]'', true, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'appointment', 'Standard Appointment Letter', '<html><body><h2>Appointment Letter</h2><p>Dear {{employeeName}},</p><p>Ref: {{referenceNo}}</p><p>You are hereby appointed as <b>{{designation}}</b> in <b>{{department}}</b> w.e.f. <b>{{joiningDate}}</b>.</p><p>Your basic pay is <b>₹{{basicPay}}</b> per month. UAN: {{uan}}. PAN: {{pan}}.</p><p>Terms and conditions apply as per service rules.</p><p>HR Department<br/>{{orgName}}</p></body></html>', ''["employeeName","referenceNo","designation","department","joiningDate","basicPay","uan","pan","orgName"]'', true, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'relieving', 'Standard Relieving Letter', '<html><body><h2>Relieving Letter</h2><p>Date: {{date}}</p><p>To Whomsoever It May Concern,</p><p>This is to certify that <b>{{employeeName}}</b> (Employee No: {{employeeNo}}) was employed with <b>{{orgName}}</b> as <b>{{designation}}</b> from <b>{{joiningDate}}</b> to <b>{{lastWorkingDay}}</b>.</p><p>They have been relieved of their duties and all dues have been settled.</p><p>We wish them all the best.</p><p>HR Department<br/>{{orgName}}</p></body></html>', ''["employeeName","employeeNo","orgName","designation","joiningDate","lastWorkingDay","date"]'', true, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'experience', 'Standard Experience Certificate', '<html><body><h2>Experience Certificate</h2><p>Date: {{date}}</p><p>This is to certify that <b>{{employeeName}}</b> worked with <b>{{orgName}}</b> as <b>{{designation}}</b> in the <b>{{department}}</b> department from <b>{{joiningDate}}</b> to <b>{{lastWorkingDay}}</b>.</p><p>During their tenure, their conduct and performance were {{performance}}.</p><p>HR Department<br/>{{orgName}}</p></body></html>', ''["employeeName","orgName","designation","department","joiningDate","lastWorkingDay","date","performance"]'', true, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'transfer', 'Standard Transfer Order', '<html><body><h2>Transfer Order</h2><p>Order No: {{orderNo}} | Date: {{date}}</p><p>{{employeeName}} ({{employeeNo}}) is hereby transferred from <b>{{fromDepartment}}</b> to <b>{{toDepartment}}</b> w.e.f. <b>{{effectiveDate}}</b>.</p><p>All other terms of employment remain unchanged.</p><p>By Order,<br/>{{orgName}}</p></body></html>', ''["employeeName","employeeNo","orderNo","date","fromDepartment","toDepartment","effectiveDate","orgName"]'', true, '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

-- ═══ Seed default shifts ═══
INSERT INTO attendance.hrms_shifts (tenant_id, name, code, start_time, end_time, grace_minutes, overtime_threshold_minutes, created_by) VALUES
('00000000-0000-0000-0000-000000000001', 'General Shift', 'GEN', '09:00', '17:30', 15, 30, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'Morning Shift', 'MORN', '06:00', '14:00', 10, 30, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'Evening Shift', 'EVE', '14:00', '22:00', 10, 30, '00000000-0000-0000-0000-000000000099'),
('00000000-0000-0000-0000-000000000001', 'Night Shift', 'NIGHT', '22:00', '06:00', 10, 30, '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

