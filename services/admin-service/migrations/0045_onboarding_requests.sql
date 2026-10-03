-- Migration: 0045_onboarding_requests.sql
-- Purpose: GAP-ADMIN-ONBOARDING-07 (+ -05) -- the platform tenant-onboarding queue.
--          /admin/onboarding listed rows from GET /v1/admin/onboarding, which no
--          service served. This table is the queue behind it: one row per
--          requesting organisation, moved through a fixed stage machine by a
--          conditional UPDATE (WHERE stage = <expected>) so two operators
--          racing the same request cannot both advance it.
--          `tenant_id` is the OPERATOR tenant that owns the queue (RLS scope),
--          not the tenant being provisioned; `provisioned_tenant_id` is filled
--          once the tenant-provision wizard has created that tenant.
--          Contact name/e-mail are personal data (DPDP): the API returns them
--          masked and an audited reveal endpoint returns the clear value.
-- Rollback: DROP TABLE tenants.onboarding_requests;
-- Affected services: admin-service
-- Idempotent: IF NOT EXISTS / DROP IF EXISTS throughout.

SET lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenants.onboarding_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  org_name              VARCHAR(200) NOT NULL,
  contact_name          VARCHAR(200) NOT NULL DEFAULT '',
  contact_email         VARCHAR(254) NOT NULL DEFAULT '',
  stage                 VARCHAR(24) NOT NULL DEFAULT 'new request',
  assigned_to           UUID,
  assigned_to_name      VARCHAR(200),
  provisioned_tenant_id UUID,
  notes                 TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID NOT NULL,
  version               INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT onboarding_requests_stage_check
    CHECK (stage IN ('new request', 'in progress', 'go-live pending', 'completed', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS ix_onboarding_requests_queue
  ON tenants.onboarding_requests (tenant_id, requested_at DESC, id);

ALTER TABLE tenants.onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.onboarding_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenants.onboarding_requests;
CREATE POLICY tenant_isolation_policy ON tenants.onboarding_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA tenants TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.onboarding_requests TO admin_svc;
  END IF;
END $$;
