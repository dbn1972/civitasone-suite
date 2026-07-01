-- 0031: Add org-structure references to hrms_employees.
-- Links employees to the ERP org structure (legal entity, cost center, location).
-- These enable: payroll posting to correct legal entity, salary costing to
-- cost center, and proper employee-location mapping. Additive + idempotent.

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS legal_entity_id UUID,   -- cross-service ref to finance org.legal_entities
  ADD COLUMN IF NOT EXISTS cost_center_id  UUID,   -- cross-service ref to finance org.cost_centers
  ADD COLUMN IF NOT EXISTS location_id     UUID;   -- cross-service ref to location-service

COMMENT ON COLUMN employee.hrms_employees.legal_entity_id IS
  'Cross-service reference to finance-service org.legal_entities.id.
   Determines which company books the salary/TDS posts to.
   For govt: maps to the DDO entity. For PSU/private: the employing subsidiary.';

COMMENT ON COLUMN employee.hrms_employees.cost_center_id IS
  'Cross-service reference to finance-service org.cost_centers.id.
   Determines which cost center bears the employee salary cost.';

COMMENT ON COLUMN employee.hrms_employees.location_id IS
  'Cross-service reference to location-service locations.id.
   Where the employee physically sits (replaces free-text station for typed lookups).';

CREATE INDEX IF NOT EXISTS idx_employee_le ON employee.hrms_employees (tenant_id, legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_employee_cc ON employee.hrms_employees (tenant_id, cost_center_id);
CREATE INDEX IF NOT EXISTS idx_employee_location ON employee.hrms_employees (tenant_id, location_id);
