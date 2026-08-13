-- CRM Service Requests module — Citizen Relationship Management.
-- Rollback: DROP TABLE IF EXISTS crm.service_requests;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid,
  citizen_name varchar(200) NOT NULL,
  citizen_phone varchar(32),
  citizen_email varchar(320),
  service_type varchar(64) NOT NULL,
  subject varchar(500) NOT NULL,
  description text,
  priority varchar(8) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status varchar(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled')),
  assigned_to uuid,
  resolution text,
  reference_no varchar(48),
  due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_requests_tenant_status
  ON crm.service_requests (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_requests_tenant_contact
  ON crm.service_requests (tenant_id, contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE crm.service_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'service_requests' AND policyname = 'tenant_isolation_service_requests'
  ) THEN
    CREATE POLICY tenant_isolation_service_requests ON crm.service_requests
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
