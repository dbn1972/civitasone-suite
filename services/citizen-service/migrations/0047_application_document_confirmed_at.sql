-- citizen-service migration 0047 - confirmed-upload state for application documents.
--
-- A row is created when the presigned PUT is issued (before the bytes are uploaded), so the row alone
-- does not prove an object exists. confirmed_at is set the first time a HEAD on the object succeeds
-- (read-model or download), and the API reports available=true only from then on.
-- Rows that exist before this migration with a storage_key are simply re-checked on their next read.
--
-- Additive, idempotent, DDL only.

SET lock_timeout = '5s';

ALTER TABLE application.citizen_app_documents
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
