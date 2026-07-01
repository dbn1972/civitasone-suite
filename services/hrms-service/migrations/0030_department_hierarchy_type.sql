-- 0030: Government/PSU hierarchy typing for hrms_departments.
--
-- The department tree becomes the single source of truth for ADMINISTRATIVE
-- hierarchy across all editions (Central Govt, State Govt, PSU, Small Office).
-- Physical location (where the office sits) is in location-service; this table
-- models WHO REPORTS TO WHOM (administrative authority).
--
-- Central Govt: Ministry → Department → Wing → Division → Section → Desk
--   (all physically in Delhi / CGO Complex — linked via location_id)
-- State Govt:   Department → Directorate → District Office → Division → Section
--   (spread across state — each node can have its own location_id)
-- PSU:          Company → Zone → Region → Unit → Department → Section
-- Small Office: Organisation → Department
--
-- Additive + idempotent.

ALTER TABLE employee.hrms_departments
  ADD COLUMN IF NOT EXISTS type       TEXT,        -- edition-specific admin level
  ADD COLUMN IF NOT EXISTS level      INTEGER,     -- numeric depth (0=root, enforces ordering)
  ADD COLUMN IF NOT EXISTS govt_tier  TEXT,        -- 'central' | 'state' | null (PSU/small)
  ADD COLUMN IF NOT EXISTS location_id UUID,       -- cross-service ref to location-service
  ADD COLUMN IF NOT EXISTS head_employee_id UUID,  -- head of this administrative unit
  ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for fast tree traversal and filtering.
CREATE INDEX IF NOT EXISTS idx_dept_parent ON employee.hrms_departments (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_dept_type   ON employee.hrms_departments (tenant_id, type) WHERE type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dept_tier   ON employee.hrms_departments (tenant_id, govt_tier) WHERE govt_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dept_location ON employee.hrms_departments (tenant_id, location_id) WHERE location_id IS NOT NULL;

COMMENT ON COLUMN employee.hrms_departments.type IS
  'Administrative level — vocabulary depends on tenant edition:
   govt+central: ministry|department|attached_office|subordinate_office|wing|division|branch|section|desk
   govt+state: department|directorate|district_office|division|section|desk
   psu: company|zone|region|unit|department|section
   small_office: organisation|department';

COMMENT ON COLUMN employee.hrms_departments.govt_tier IS
  'Central vs State Government distinction. NULL for PSU/small_office editions.
   Central Govt departments are typically all in Delhi (one location_id).
   State Govt departments are spread across the state (per-node location_id).';

COMMENT ON COLUMN employee.hrms_departments.location_id IS
  'Cross-service reference to location-service locations.id.
   Binds this administrative unit to a physical office.
   Central Govt: most nodes share the same Delhi/CGO location.
   State Govt: each directorate/district-office has its own location.';
