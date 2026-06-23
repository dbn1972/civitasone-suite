-- Migration 0007: Reporting Officer + Geo-fenced Video Attendance + Holiday enforcement

-- ═══ Office Locations with Geo-Boundaries ═══
CREATE TABLE IF NOT EXISTS employee.hrms_office_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(256) NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_meters INT NOT NULL DEFAULT 200,  -- geo-fence radius
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_office_loc_tenant ON employee.hrms_office_locations(tenant_id);

-- ═══ Add reporting officer + office location to employees ═══
-- (managerId already exists, we use it as reporting officer)
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS office_location_id UUID,
  ADD COLUMN IF NOT EXISTS reporting_officer_id UUID,
  ADD COLUMN IF NOT EXISTS hod_id UUID;

-- ═══ Geo-Attendance Records (video selfie + location) ═══
CREATE TABLE IF NOT EXISTS attendance.hrms_geo_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  check_type VARCHAR(8) NOT NULL CHECK (check_type IN ('check_in', 'check_out')),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_meters DOUBLE PRECISION,
  office_location_id UUID,
  within_geofence BOOLEAN NOT NULL DEFAULT FALSE,
  distance_from_office_meters DOUBLE PRECISION,
  selfie_file_key VARCHAR(1024),  -- S3 key for video/photo
  selfie_verified BOOLEAN NOT NULL DEFAULT FALSE,
  device_id VARCHAR(256),
  ip_address VARCHAR(45),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  
);
CREATE INDEX IF NOT EXISTS idx_geo_att_emp_date ON attendance.hrms_geo_attendance(tenant_id, employee_id, attendance_date);

-- ═══ Seed office locations ═══
INSERT INTO employee.hrms_office_locations (id, tenant_id, name, address, latitude, longitude, radius_meters, created_by) VALUES
  ('aaaaaaaa-0001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Head Office Delhi', 'Shastri Bhawan, New Delhi', 28.6139, 77.2090, 200, '00000000-0000-0000-0000-000000000099'),
  ('aaaaaaaa-0001-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Branch Office Mumbai', 'CGO Complex, Mumbai', 19.0760, 72.8777, 150, '00000000-0000-0000-0000-000000000099'),
  ('aaaaaaaa-0001-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Regional Office Bengaluru', 'Vidhana Soudha, Bengaluru', 12.9716, 77.5946, 250, '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

-- ═══ Assign reporting officers and office locations to employees ═══
UPDATE employee.hrms_employees SET
  reporting_officer_id = 'eeeeeeee-0001-0000-0000-000000000006',
  office_location_id = 'aaaaaaaa-0001-0000-0000-000000000001'
WHERE id = 'eeeeeeee-0001-0000-0000-000000000005' AND tenant_id = '00000000-0000-0000-0000-000000000001';

UPDATE employee.hrms_employees SET
  reporting_officer_id = 'eeeeeeee-0001-0000-0000-000000000005',
  office_location_id = 'aaaaaaaa-0001-0000-0000-000000000001'
WHERE id = 'eeeeeeee-0001-0000-0000-000000000006' AND tenant_id = '00000000-0000-0000-0000-000000000001';

