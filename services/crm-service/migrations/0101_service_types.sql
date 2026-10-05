-- Purpose: GAP-CRM-SERVICE-REQUESTS-NEW-02 — per-tenant master of service-request
--   types, replacing the hard-coded 10-item constant in the new-request form with an
--   admin-editable taxonomy (mirrors crm.document_types / crm.lead_reason_codes).
--   The table is intentionally created EMPTY: the built-in default list stays a
--   labelled web-side fallback (shown when a tenant has configured none / the load
--   fails), so no fake tenant rows are inserted and existing service_requests that
--   store a free-text service_type label keep working unchanged.
-- Rollback: DROP TABLE IF EXISTS crm.service_types;
-- Affected services: crm-service (service-requests module)
-- Sequencing: additive — one new tenant-scoped table, no backfill, no column changes.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.service_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        varchar(64) NOT NULL,
  label       varchar(160) NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_service_types_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_service_types_tenant
  ON crm.service_types(tenant_id) WHERE active = true;

ALTER TABLE crm.service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.service_types FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'service_types_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'service_types'
  ) THEN
    CREATE POLICY service_types_tenant_isolation ON crm.service_types
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.service_types TO crm_svc;
  END IF;
END $g$;
