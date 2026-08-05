-- Purpose: DM-002 (BRD §7.12) document types + verification + expiry. crm.document_types
--   is a per-tenant catalogue of expected document kinds (code unique per tenant) that
--   may be mandatory for a subject_type, may require an expiry date, and may require
--   verification. Adds expiry_date + verification_status/verified_by/verified_at to
--   crm.documents, and a composite FK so a document's doc_type must name a real type.
--   crm.list_document_alert_tenants() (SECURITY DEFINER) lets the non-superuser worker
--   discover tenants with enabled types past FORCE RLS for the alert scheduler — tenant
--   ids only, mirroring crm.list_task_escalation_tenants() (migration 0055).
-- Rollback: ALTER TABLE crm.documents DROP COLUMN IF EXISTS verification_status, ... ;
--           DROP FUNCTION IF EXISTS crm.list_document_alert_tenants();
--           DROP TABLE IF EXISTS crm.document_types;
-- Affected services: crm-service (documents module)
-- Sequencing: additive — new table + nullable columns, no backfill.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  applies_to varchar(16) NOT NULL
    CHECK (applies_to IN ('lead','contact','account','opportunity','quotation','case')),
  mandatory boolean NOT NULL DEFAULT false,
  expiry_required boolean NOT NULL DEFAULT false,
  verification_required boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_document_types_code UNIQUE (tenant_id, code)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_types_tenant
  ON crm.document_types(tenant_id) WHERE enabled = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_types_applies
  ON crm.document_types(tenant_id, applies_to) WHERE enabled = true AND mandatory = true;

ALTER TABLE crm.document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.document_types FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'document_types_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'document_types'
  ) THEN
    CREATE POLICY document_types_tenant_isolation ON crm.document_types
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- DM-002 columns on documents: expiry + verification workflow.
ALTER TABLE crm.documents ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE crm.documents ADD COLUMN IF NOT EXISTS verification_status varchar(12)
  NOT NULL DEFAULT 'pending'
  CHECK (verification_status IN ('pending','verified','rejected'));
ALTER TABLE crm.documents ADD COLUMN IF NOT EXISTS verified_by uuid;
ALTER TABLE crm.documents ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- A document's doc_type must name a real type for the same tenant (composite FK).
-- doc_type is nullable; MATCH SIMPLE skips the check when it is NULL.
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_doc_type'
  ) THEN
    ALTER TABLE crm.documents
      ADD CONSTRAINT fk_documents_doc_type
      FOREIGN KEY (tenant_id, doc_type)
      REFERENCES crm.document_types (tenant_id, code)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $fk$;

-- Scan support for the expiry-alert scheduler: current, non-deleted, dated docs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_expiry
  ON crm.documents(tenant_id, expiry_date)
  WHERE is_current = true AND deleted_at IS NULL AND expiry_date IS NOT NULL;

CREATE OR REPLACE FUNCTION crm.list_document_alert_tenants()
RETURNS TABLE(tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, pg_temp
AS $fn$
  SELECT DISTINCT t.tenant_id FROM crm.document_types t WHERE t.enabled = true
  UNION
  SELECT DISTINCT d.tenant_id FROM crm.documents d
    WHERE d.is_current = true AND d.deleted_at IS NULL AND d.expiry_date IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION crm.list_document_alert_tenants() FROM PUBLIC;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.document_types TO crm_svc;
    GRANT EXECUTE ON FUNCTION crm.list_document_alert_tenants() TO crm_svc;
  END IF;
END $g$;
