-- Gap 3: Appointment/Booking Module — appointments table.
-- Rollback: DROP TABLE IF EXISTS crm.appointments;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  service_type varchar(64) NOT NULL,
  location_id uuid,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status varchar(16) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes text,
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_tenant
  ON crm.appointments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_contact
  ON crm.appointments (tenant_id, contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_schedule
  ON crm.appointments (tenant_id, location_id, scheduled_at);

ALTER TABLE crm.appointments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'appointments' AND policyname = 'tenant_isolation_appointments'
  ) THEN
    CREATE POLICY tenant_isolation_appointments ON crm.appointments
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
