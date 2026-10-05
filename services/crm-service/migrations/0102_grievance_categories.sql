-- Purpose: GAP-CRM-GRIEVANCES-NEW-03 — per-tenant master of grievance categories,
--   replacing the hard-coded nine-item CPGRAMS-aligned constant in the new-grievance
--   form with an admin-editable taxonomy (mirrors crm.document_types /
--   crm.lead_reason_codes). The table is intentionally created EMPTY: the built-in
--   default list stays a labelled web-side fallback (shown when a tenant has
--   configured none / the load fails), so no fake tenant rows are inserted and
--   existing grievances that store a free-text category label keep working unchanged.
-- Rollback: DROP TABLE IF EXISTS crm.grievance_categories;
-- Affected services: crm-service (grievances module)
-- Sequencing: additive — one new tenant-scoped table, no backfill, no column changes.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.grievance_categories (
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
  CONSTRAINT uq_grievance_categories_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_grievance_categories_tenant
  ON crm.grievance_categories(tenant_id) WHERE active = true;

ALTER TABLE crm.grievance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.grievance_categories FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'grievance_categories_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'grievance_categories'
  ) THEN
    CREATE POLICY grievance_categories_tenant_isolation ON crm.grievance_categories
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.grievance_categories TO crm_svc;
  END IF;
END $g$;
