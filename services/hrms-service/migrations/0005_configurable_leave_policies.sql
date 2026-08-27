-- Migration 0005: Configurable leave policies per employee type
-- HR Admin can CRUD these via API — no code changes needed to adjust policies

-- ═══ Leave Policy Rules (configurable per tenant + employee type) ═══
CREATE TABLE IF NOT EXISTS leave.hrms_leave_policy_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  leave_type_id UUID NOT NULL REFERENCES leave.hrms_leave_types(id),
  employee_type VARCHAR(32) NOT NULL, -- permanent, contractual, vendor_deputed, deputation, consultant
  max_days_per_year INT NOT NULL DEFAULT 0,
  carry_forward BOOLEAN NOT NULL DEFAULT FALSE,
  max_accumulation INT NOT NULL DEFAULT 0,
  encashable BOOLEAN NOT NULL DEFAULT FALSE,
  count_method VARCHAR(16) NOT NULL DEFAULT 'calendar', -- calendar | working_days
  max_continuous_days INT NOT NULL DEFAULT 365,
  min_service_months INT NOT NULL DEFAULT 0,
  gender_restriction VARCHAR(8) DEFAULT NULL, -- NULL=all, 'male', 'female'
  requires_medical_cert BOOLEAN NOT NULL DEFAULT FALSE,
  requires_medical_cert_after_days INT NOT NULL DEFAULT 3,
  prefix_suffix_rule BOOLEAN NOT NULL DEFAULT FALSE,
  sandwich_rule BOOLEAN NOT NULL DEFAULT FALSE,
  pro_rata_on_joining BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, leave_type_id, employee_type)
);

CREATE INDEX IF NOT EXISTS idx_leave_policy_rules_tenant
  ON leave.hrms_leave_policy_rules(tenant_id, employee_type, is_active);

-- ═══ Add new leave types: Medical Leave + Extraordinary Leave ═══
INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, is_encashable, carry_forward, created_by, updated_by) VALUES
  ('eeeeeeee-0001-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', 'MED', 'Medical Leave', 15, false, false, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('eeeeeeee-0001-0000-0000-000000000051', '00000000-0000-0000-0000-000000000001', 'EOL', 'Extraordinary Leave (without pay)', 365, false, false, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

-- ═══ Seed default policies for all employee types ═══
-- Get existing leave type IDs
DO $$
DECLARE
  t_id UUID := '00000000-0000-0000-0000-000000000001';
  actor UUID := '00000000-0000-0000-0000-000000000099';
  cl_id UUID;
  el_id UUID;
  hpl_id UUID;
  med_id UUID := 'eeeeeeee-0001-0000-0000-000000000050';
  eol_id UUID := 'eeeeeeee-0001-0000-0000-000000000051';
BEGIN
  SELECT id INTO cl_id FROM leave.hrms_leave_types WHERE tenant_id = t_id AND code = 'CL' LIMIT 1;
  SELECT id INTO el_id FROM leave.hrms_leave_types WHERE tenant_id = t_id AND code = 'EL' LIMIT 1;
  SELECT id INTO hpl_id FROM leave.hrms_leave_types WHERE tenant_id = t_id AND code = 'HPL' LIMIT 1;

  -- FIXED: on a fresh cluster no migration ever seeds the base CL/EL leave
  -- types (only a long-lived, hand-patched dev DB had them already), so
  -- cl_id/el_id fell back to hardcoded UUIDs that named no actual row and
  -- the policy-rule INSERTs below violated their leave_type_id FK. HPL
  -- already used an insert-if-missing pattern; CL/EL now follow it too,
  -- using the same day counts/flags this file already assumes for them at
  -- the 'permanent' policy rows, matching src/modules/leave/rules-engine.ts.
  IF cl_id IS NULL THEN
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, is_encashable, carry_forward, created_by, updated_by)
    VALUES ('eeeeeeee-0001-0000-0000-000000000007', t_id, 'CL', 'Casual Leave', 8, false, false, actor, actor) ON CONFLICT DO NOTHING;
    cl_id := 'eeeeeeee-0001-0000-0000-000000000007';
  END IF;
  IF el_id IS NULL THEN
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, is_encashable, carry_forward, created_by, updated_by)
    VALUES ('eeeeeeee-0001-0000-0000-000000000008', t_id, 'EL', 'Earned Leave', 30, true, true, actor, actor) ON CONFLICT DO NOTHING;
    el_id := 'eeeeeeee-0001-0000-0000-000000000008';
  END IF;
  IF hpl_id IS NULL THEN
    INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, is_encashable, carry_forward, created_by, updated_by)
    VALUES ('eeeeeeee-0001-0000-0000-000000000052', t_id, 'HPL', 'Half Pay Leave', 20, false, true, actor, actor) ON CONFLICT DO NOTHING;
    hpl_id := 'eeeeeeee-0001-0000-0000-000000000052';
  END IF;

  -- PERMANENT employees
  INSERT INTO leave.hrms_leave_policy_rules (tenant_id, leave_type_id, employee_type, max_days_per_year, carry_forward, max_accumulation, encashable, count_method, max_continuous_days, min_service_months, prefix_suffix_rule, sandwich_rule, created_by, updated_by) VALUES
    (t_id, cl_id,  'permanent', 8,   false, 8,    false, 'calendar',     8,   0,  true,  true,  actor, actor),
    (t_id, el_id,  'permanent', 30,  true,  300,  true,  'working_days', 180, 12, false, false, actor, actor),
    (t_id, hpl_id, 'permanent', 20,  true,  9999, false, 'calendar',     180, 0,  false, false, actor, actor),
    (t_id, med_id, 'permanent', 15,  false, 15,   false, 'calendar',     15,  0,  false, false, actor, actor),
    (t_id, eol_id, 'permanent', 365, false, 365,  false, 'calendar',     365, 0,  false, false, actor, actor)
  ON CONFLICT (tenant_id, leave_type_id, employee_type) DO NOTHING;

  -- CONTRACTUAL employees (limited)
  INSERT INTO leave.hrms_leave_policy_rules (tenant_id, leave_type_id, employee_type, max_days_per_year, carry_forward, max_accumulation, encashable, count_method, max_continuous_days, min_service_months, prefix_suffix_rule, sandwich_rule, created_by, updated_by) VALUES
    (t_id, cl_id,  'contractual', 8,  false, 8,  false, 'calendar', 5,  0, false, false, actor, actor),
    (t_id, med_id, 'contractual', 7,  false, 7,  false, 'calendar', 7,  0, false, false, actor, actor),
    (t_id, eol_id, 'contractual', 30, false, 30, false, 'calendar', 30, 0, false, false, actor, actor)
  ON CONFLICT (tenant_id, leave_type_id, employee_type) DO NOTHING;

  -- VENDOR_DEPUTED employees (vendor outsourced staff)
  INSERT INTO leave.hrms_leave_policy_rules (tenant_id, leave_type_id, employee_type, max_days_per_year, carry_forward, max_accumulation, encashable, count_method, max_continuous_days, min_service_months, prefix_suffix_rule, sandwich_rule, requires_medical_cert, requires_medical_cert_after_days, created_by, updated_by) VALUES
    (t_id, cl_id,  'vendor_deputed', 6,  false, 6,  false, 'calendar', 3,  0, false, false, false, 3, actor, actor),
    (t_id, med_id, 'vendor_deputed', 5,  false, 5,  false, 'calendar', 5,  0, false, false, true,  1, actor, actor),
    (t_id, eol_id, 'vendor_deputed', 15, false, 15, false, 'calendar', 15, 0, false, false, false, 3, actor, actor)
  ON CONFLICT (tenant_id, leave_type_id, employee_type) DO NOTHING;

  -- DEPUTATION employees
  INSERT INTO leave.hrms_leave_policy_rules (tenant_id, leave_type_id, employee_type, max_days_per_year, carry_forward, max_accumulation, encashable, count_method, max_continuous_days, min_service_months, prefix_suffix_rule, sandwich_rule, created_by, updated_by) VALUES
    (t_id, cl_id,  'deputation', 8,  false, 8,   false, 'calendar',     8,   0,  true, true,  actor, actor),
    (t_id, el_id,  'deputation', 30, true,  300, true,  'working_days', 180, 12, false, false, actor, actor),
    (t_id, hpl_id, 'deputation', 20, true,  9999,false, 'calendar',     180, 0,  false, false, actor, actor),
    (t_id, med_id, 'deputation', 15, false, 15,  false, 'calendar',     15,  0,  false, false, actor, actor)
  ON CONFLICT (tenant_id, leave_type_id, employee_type) DO NOTHING;
END $$;
