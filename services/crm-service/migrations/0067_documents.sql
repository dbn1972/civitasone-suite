-- Purpose: DM-001 (BRD §7.12) Document & Attachment Management. crm.documents holds
--   uploaded file METADATA (bytes live in S3 via @civitasone/storage; storage_key is
--   the object key). Access-controlled (tenant + subject scoped), versioned (a supersede
--   bumps version and flips the old row is_current=false; one current row per storage
--   lineage), and malware-scanned (scan_status pending->clean|infected|error; downloads
--   are blocked while infected). DM-003: storage_provider records that files live
--   externally (s3 today; knowledge_dms/external reserved) while metadata stays in CRM.
-- Rollback: DROP TABLE IF EXISTS crm.documents;
-- Affected services: crm-service (documents module)
-- Sequencing: additive — new tenant-scoped table, no destructive change.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_type varchar(16) NOT NULL
    CHECK (subject_type IN ('lead','contact','account','opportunity','quotation','case')),
  subject_id uuid NOT NULL,
  doc_type varchar(64),
  title text NOT NULL,
  filename text NOT NULL,
  storage_key text NOT NULL,
  storage_provider varchar(20) NOT NULL DEFAULT 's3'
    CHECK (storage_provider IN ('s3','knowledge_dms','external')),
  mime_type varchar(255) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum text,
  -- Versioning: every row belongs to a lineage. A brand-new upload starts its own
  -- lineage (lineage_id = id); a supersede reuses the superseded row's lineage_id,
  -- bumps version, and flips the prior row is_current=false.
  lineage_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_current boolean NOT NULL DEFAULT true,
  scan_status varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending','clean','infected','error')),
  deleted_at timestamptz,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_tenant ON crm.documents(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_subject
  ON crm.documents(tenant_id, subject_type, subject_id) WHERE deleted_at IS NULL;
-- At most one CURRENT row per storage lineage (the versioning invariant).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_documents_one_current
  ON crm.documents(tenant_id, lineage_id) WHERE is_current = true;

ALTER TABLE crm.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.documents FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'documents_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'documents'
  ) THEN
    CREATE POLICY documents_tenant_isolation ON crm.documents
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.documents TO crm_svc;
  END IF;
END $g$;
