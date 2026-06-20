CREATE INDEX IF NOT EXISTS idx_employees_tenant_status
  ON employee.employees (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_leave_tenant_status
  ON leave.leave_applications (tenant_id, status);
