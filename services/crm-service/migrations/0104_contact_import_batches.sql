-- GAP-CRM-CONTACTS-IMPORT-04: persist per-batch bulk-import outcomes so the
--   import page can poll a job-status/result endpoint and show accepted /
--   rejected counts + a server-built "download rejected rows" CSV, instead of
--   only a fire-and-forget "queued" message. The bulk-import consumer already
--   computes inserted/skipped/errored + per-row reasons; this table is where it
--   records them, inside the SAME transaction as the writes (no TOCTOU).
--
--   rejected_rows is a JSONB array of { index, reason } — the ROW NUMBER and a
--   coarse machine reason only (duplicate_email | error). It deliberately holds
--   NO PII (no name/email/phone) so a rejected-rows download or an audit reader
--   never leaks contact data beyond the row position the uploader already has.
--
-- Rollback: DROP TABLE IF EXISTS crm.contact_import_batches;
-- Affected services: crm-service (contacts module, bulk import)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.contact_import_batches (
  batch_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('processing', 'completed', 'failed')),
  total integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  errored integer NOT NULL DEFAULT 0,
  rejected_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_import_batches_tenant
  ON crm.contact_import_batches (tenant_id, created_at DESC);

ALTER TABLE crm.contact_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.contact_import_batches FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_import_batches' AND policyname = 'tenant_isolation_contact_import_batches'
  ) THEN
    CREATE POLICY tenant_isolation_contact_import_batches ON crm.contact_import_batches
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
