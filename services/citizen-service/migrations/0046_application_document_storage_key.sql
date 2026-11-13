-- citizen-service migration 0046 - real object storage for application documents.
--
-- application.citizen_app_documents.doc_url used to hold a FABRICATED link
-- (https://s3.example.com/<tenant>/applications/<app>/<docType>?expires=...): no object was
-- ever stored, so no download link could work. New rows store the S3 OBJECT KEY in storage_key
-- (never a URL); short-lived presigned GET URLs are minted on read, after the tenant/ownership
-- check. doc_url becomes nullable (new rows leave it NULL) and is kept only so legacy rows stay
-- readable as "document not available".
--
-- Additive + idempotent. DDL only (no DML), so no NO FORCE / FORCE wrap needed.
--
-- BACKFILL (legacy rows, storage_key IS NULL): there is no object behind them, so nothing can be
-- migrated in place. They are reported as available=false ("document not available") by the API.
-- To recover each one the applicant (or an officer on their behalf) re-uploads the document via
-- POST /v1/citizen/applications/:id/documents (a new row with a real object is created). List what
-- needs re-uploading, per tenant, with:
--
--   SELECT tenant_id, application_id, doc_type, uploaded_at
--     FROM application.citizen_app_documents
--    WHERE storage_key IS NULL
--    ORDER BY tenant_id, application_id;
--
-- Once an applicant has re-uploaded, the superseded fake row can be removed with:
--
--   DELETE FROM application.citizen_app_documents d
--    WHERE d.storage_key IS NULL
--      AND EXISTS (SELECT 1 FROM application.citizen_app_documents n
--                   WHERE n.tenant_id = d.tenant_id AND n.application_id = d.application_id
--                     AND n.doc_type = d.doc_type AND n.storage_key IS NOT NULL);
--
-- (run both under the owning role with the tenant GUC set, or as the table owner with
-- NO FORCE ROW LEVEL SECURITY temporarily, per the other citizen-service data fixes.)

SET lock_timeout = '5s';

ALTER TABLE application.citizen_app_documents
  ADD COLUMN IF NOT EXISTS storage_key       text,
  ADD COLUMN IF NOT EXISTS content_type      varchar(100),
  ADD COLUMN IF NOT EXISTS size_bytes        bigint,
  ADD COLUMN IF NOT EXISTS original_filename varchar(255);

ALTER TABLE application.citizen_app_documents
  ALTER COLUMN doc_url DROP NOT NULL;
