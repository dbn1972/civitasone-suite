BEGIN;

-- WFH Request table
CREATE TABLE IF NOT EXISTS attendance.hrms_wfh_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  employee_id   uuid NOT NULL REFERENCES employee.hrms_employees(id) ON DELETE CASCADE,
  from_date     date NOT NULL,
  to_date       date NOT NULL,
  reason        text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by   uuid REFERENCES employee.hrms_employees(id),
  approved_at   timestamptz,
  rejection_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid
);
CREATE INDEX IF NOT EXISTS idx_wfh_requests_tenant_employee ON attendance.hrms_wfh_requests(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_wfh_requests_tenant_status ON attendance.hrms_wfh_requests(tenant_id, status);

-- Shift Change Request table
CREATE TABLE IF NOT EXISTS attendance.hrms_shift_change_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  employee_id     uuid NOT NULL REFERENCES employee.hrms_employees(id) ON DELETE CASCADE,
  current_shift   text NOT NULL,
  requested_shift text NOT NULL,
  effective_date  date NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by     uuid REFERENCES employee.hrms_employees(id),
  approved_at     timestamptz,
  rejection_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid
);
CREATE INDEX IF NOT EXISTS idx_shift_change_tenant_employee ON attendance.hrms_shift_change_requests(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_change_tenant_status ON attendance.hrms_shift_change_requests(tenant_id, status);

COMMIT;
