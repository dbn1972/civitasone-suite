-- 0021_pii_interviews_qs.sql
-- P0 remediation for hrms-service. Additive + idempotent only. Applied with the
-- hrms_svc role on civitas_hrms.
--
--   P0-1 (DPDP PII at rest): sensitive PII columns are encrypted at the app
--         layer (AES-256-GCM envelope) and stored as ciphertext text. pan /
--         bank_ifsc were VARCHAR(16) which cannot hold ciphertext, so widen them
--         to TEXT. (aadhaar_ref / bank_account_no are already TEXT.) The
--         plaintext->ciphertext backfill is performed by an application-side
--         script using the same PII_ENC_KEY; the read path transparently passes
--         through any not-yet-encrypted legacy value (enc:v1: prefix detection).
--   P0-2 (recruitment interviews persistence): recruitment.hrms_interviews
--         already exists (migration 0008); the route is rewired from an
--         in-memory array to that table. Only add helpful lookup indexes here.
--   P0-3 (qualifying service): no schema change — netting reads the existing
--         lifecycle.hrms_service_book_entries.

-- ---------------------------------------------------------------------------
-- P0-1: widen PII columns so AES-GCM ciphertext fits.
-- ---------------------------------------------------------------------------
ALTER TABLE employee.hrms_employees ALTER COLUMN pan TYPE text;
ALTER TABLE employee.hrms_employees ALTER COLUMN bank_ifsc TYPE text;

-- ---------------------------------------------------------------------------
-- P0-2: recruitment.hrms_interviews already exists (0008). Ensure lookup
-- indexes used by the rewired list route exist (idempotent).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_interviews_tenant_job
  ON recruitment.hrms_interviews(tenant_id, job_opening_id);
CREATE INDEX IF NOT EXISTS idx_interviews_tenant_application
  ON recruitment.hrms_interviews(tenant_id, application_id);
