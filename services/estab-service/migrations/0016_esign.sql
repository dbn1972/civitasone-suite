-- estab-service: legal e-signature (H1) — Aadhaar eSign (ASP↔ESP, web) and
-- DSC token (card, desktop signer → web POST), pluggable per tenant.
-- Additive, idempotent, forward-only.

-- Per-tenant signing policy: whether signing is disabled / optional / mandatory,
-- and which methods are permitted. Default 'disabled' so existing flows (the
-- tamper-evident hash chain) are unaffected until a tenant opts in.
CREATE TABLE IF NOT EXISTS files.estab_sign_config (
  tenant_id       uuid        PRIMARY KEY,
  mode            varchar(16) NOT NULL DEFAULT 'disabled',   -- disabled|optional|mandatory
  allowed_methods jsonb       NOT NULL DEFAULT '["aadhaar_esign","dsc"]'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT estab_sign_config_mode_check CHECK (mode IN ('disabled','optional','mandatory'))
);

-- A verifiable signature record over a signed artefact (a green note or a DFA).
-- Stores the CMS/PKCS#7 + signer certificate identity + revocation check, so an
-- approval is legally bound to an identity (IT Act 2000 §3A), not just hashed.
CREATE TABLE IF NOT EXISTS files.estab_signature (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  subject_type          varchar(16) NOT NULL,                 -- noting|dfa
  subject_id            uuid        NOT NULL,
  file_id               uuid,
  doc_hash              text        NOT NULL,                 -- SHA-256 of the signed content
  method                varchar(24) NOT NULL,                 -- aadhaar_esign|dsc
  provider              varchar(48) NOT NULL,                 -- ESP / signer provider name
  pkcs7                 text        NOT NULL,                 -- CMS/PKCS#7 (base64)
  cert_serial           text,
  cert_subject          text,
  cert_issuer           text,
  signer_id             uuid        NOT NULL,
  signed_at             timestamptz NOT NULL,
  revocation_checked_at timestamptz,
  valid                 boolean     NOT NULL DEFAULT true,
  txn_ref               text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estab_signature_subject_check CHECK (subject_type IN ('noting','dfa')),
  CONSTRAINT estab_signature_method_check  CHECK (method IN ('aadhaar_esign','dsc'))
);
CREATE INDEX IF NOT EXISTS idx_estab_signature_subject
  ON files.estab_signature (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_estab_signature_valid
  ON files.estab_signature (tenant_id, subject_type, subject_id, valid);
