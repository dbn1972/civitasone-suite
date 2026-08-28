-- FIXED: table names below never existed anywhere in this service (grepped
-- every migration's CREATE TABLE). The real tables carry an hrms_ prefix:
-- employee.hrms_employees and leave.hrms_leave_apps. Corrected to match.
CREATE INDEX IF NOT EXISTS idx_employees_tenant_status
  ON employee.hrms_employees (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_leave_tenant_status
  ON leave.hrms_leave_apps (tenant_id, status);
