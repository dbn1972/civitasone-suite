-- Migration 0090: DSC-signed PFMS treasury batches (GAP-FINANCE-PFMS-01)
--
-- finance.pfms.batch_sign no longer accepts a hand-pasted "signature payload". It hashes the CANONICAL
-- batch (see modules/pfms/dsc-batch.ts, version civitas-pfms-batch/v1), builds the XML-DSig SignedInfo
-- over that digest, has the tenant's DSC signer (connector-framework DscSigner port) sign the SignedInfo
-- hash, and stores the result here so the signature can be re-verified before the batch is submitted.
--
--   batch_digest          hex SHA-256 of the canonical batch (the XML-DSig Reference DigestValue)
--   signed_info_hash      hex SHA-256 of the XML-DSig SignedInfo -- the hash the DSC signed
--   dsc_signature         base64 SignatureValue returned by the signer
--   dsc_algorithm         signer-reported algorithm (MOCK-* for the sandbox mock)
--   dsc_signature_method  XML-DSig SignatureMethod URI declared inside SignedInfo
--   dsc_cert_serial       certificate serial reported by the signer
--   dsc_signer_ref        signing identity reference handed to the signer (token slot / HSM key label)
--   dsc_provider_key      catalogue provider key of the tenant integration used
--   dsc_environment       sandbox | production (tenant integration environment at signing time)
--   dsc_mock              true when the sandbox MOCK signer produced the signature (NOT a legal signature)
--   dsc_canonical_version canonicalisation version the digest was computed with
--   dsc_xmldsig           the assembled XML-DSig <Signature> envelope
--   dsc_verified_at       last successful pre-submission verification
--
-- signed_at / signed_by / signature_ref already exist (the signing actor and instant).
-- Additive + idempotent. Rollback: ALTER TABLE payments.finance_pfms DROP COLUMN <each above>.
SET lock_timeout = '5s';

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS batch_digest          varchar(64),
  ADD COLUMN IF NOT EXISTS signed_info_hash      varchar(64),
  ADD COLUMN IF NOT EXISTS dsc_signature         text,
  ADD COLUMN IF NOT EXISTS dsc_algorithm         varchar(64),
  ADD COLUMN IF NOT EXISTS dsc_signature_method  varchar(200),
  ADD COLUMN IF NOT EXISTS dsc_cert_serial       varchar(128),
  ADD COLUMN IF NOT EXISTS dsc_signer_ref        varchar(256),
  ADD COLUMN IF NOT EXISTS dsc_provider_key      varchar(64),
  ADD COLUMN IF NOT EXISTS dsc_environment       varchar(16),
  ADD COLUMN IF NOT EXISTS dsc_mock              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dsc_canonical_version varchar(40),
  ADD COLUMN IF NOT EXISTS dsc_xmldsig           text,
  ADD COLUMN IF NOT EXISTS dsc_verified_at       timestamptz;

DO $$ BEGIN
  ALTER TABLE payments.finance_pfms
    ADD CONSTRAINT finance_pfms_dsc_env_chk CHECK (dsc_environment IS NULL OR dsc_environment IN ('sandbox','production'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
