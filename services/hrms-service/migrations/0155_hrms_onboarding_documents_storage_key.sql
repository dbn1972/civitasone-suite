-- 0155_hrms_onboarding_documents_storage_key.sql
-- GAP-HR-ONBOARDING-DETAIL-02: hrms_onboarding_documents had no column for
-- the uploaded file's object-storage key, so even a wired mark-received
-- action recorded only status/received_at -- the actual uploaded file was
-- unrecoverable, and HR had no way to open what was submitted.
--
-- Nullable, additive: a document can be marked received (e.g. a manual HR
-- action with no fresh upload attached) without ever having a storage key.
--
-- ADD COLUMN ... (no NOT NULL, no DEFAULT needing a table rewrite) is a
-- metadata-only change on PG11+, same posture as this migration set's other
-- additive ADD COLUMNs (e.g. 0147, 0151).
--
-- Rollback:
--   ALTER TABLE lifecycle.hrms_onboarding_documents DROP COLUMN IF EXISTS storage_key;
--   ALTER TABLE lifecycle.hrms_onboarding_documents DROP COLUMN IF EXISTS file_name;

SET lock_timeout = '5s';

ALTER TABLE lifecycle.hrms_onboarding_documents
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS file_name varchar(255);
