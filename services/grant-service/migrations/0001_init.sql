-- grant-service initial migration
-- Run as: grant_svc on civitas_grant
-- Prefix: grant_
-- L2 schemas: scheme, application, disbursement, utilisation, beneficiary

CREATE SCHEMA IF NOT EXISTS scheme;
CREATE SCHEMA IF NOT EXISTS application;
CREATE SCHEMA IF NOT EXISTS disbursement;
CREATE SCHEMA IF NOT EXISTS utilisation;
CREATE SCHEMA IF NOT EXISTS beneficiary;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ── _outbox / _inbox ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ── scheme module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheme.grant_schemes (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid         NOT NULL,
  code             text         NOT NULL,
  name             text         NOT NULL,
  sanction_ref     text,                        -- opaque "finance_sanction:UUID"
  budget_minor     bigint       NOT NULL DEFAULT 0,
  disbursed_minor  bigint       NOT NULL DEFAULT 0,
  min_amount_minor bigint       NOT NULL DEFAULT 0,
  max_amount_minor bigint       NOT NULL DEFAULT 0,
  currency         char(3)      NOT NULL DEFAULT 'INR',
  status           varchar(24)  NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','closed','suspended')),
  open_at          timestamptz,
  close_at         timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS scheme.grant_eligibility_criteria (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  scheme_id      uuid        NOT NULL,
  criterion_key  varchar(32) NOT NULL,          -- age | income | category | geography
  min_value      text,
  max_value      text,
  allowed_values text[],                        -- for enum-type criteria (category)
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grant_eligibility_scheme
  ON scheme.grant_eligibility_criteria (scheme_id);

-- ── application module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS application.grant_applications (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  grant_no              text        NOT NULL,
  scheme_id             uuid        NOT NULL,
  beneficiary_id        uuid        NOT NULL,
  purpose               text        NOT NULL,
  amount_requested_minor bigint     NOT NULL DEFAULT 0,
  amount_approved_minor  bigint     NOT NULL DEFAULT 0,
  currency              char(3)     NOT NULL DEFAULT 'INR',
  status                varchar(32) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','submitted','under_review','approved','rejected','withdrawn')),
  submitted_at          timestamptz,
  approved_at           timestamptz,
  rejected_at           timestamptz,
  rejection_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_by            uuid        NOT NULL,
  version               integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, grant_no)
);

CREATE INDEX IF NOT EXISTS idx_grant_applications_scheme
  ON application.grant_applications (scheme_id);
CREATE INDEX IF NOT EXISTS idx_grant_applications_beneficiary
  ON application.grant_applications (beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_grant_applications_status
  ON application.grant_applications (tenant_id, status);

CREATE TABLE IF NOT EXISTS application.grant_app_documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  doc_type       varchar(64) NOT NULL,          -- identity | income_proof | photo | other
  doc_ref        text        NOT NULL,          -- opaque S3 key
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grant_app_docs_application
  ON application.grant_app_documents (application_id);

CREATE TABLE IF NOT EXISTS application.grant_scores (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid         NOT NULL,
  application_id    uuid         NOT NULL,
  reviewer_ref      text         NOT NULL,      -- opaque "identity_user:UUID"
  technical_score   numeric(5,2) NOT NULL DEFAULT 0,
  financial_score   numeric(5,2) NOT NULL DEFAULT 0,
  total_score       numeric(5,2) NOT NULL DEFAULT 0,
  recommendation    text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  created_by        uuid         NOT NULL,
  updated_by        uuid         NOT NULL,
  version           integer      NOT NULL DEFAULT 1,
  UNIQUE (application_id, reviewer_ref)
);

-- ── disbursement module ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disbursement.grant_installments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  installment_no integer     NOT NULL,
  amount_minor   bigint      NOT NULL DEFAULT 0,
  currency       char(3)     NOT NULL DEFAULT 'INR',
  status         varchar(24) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','disbursed','failed')),
  condition      text,
  due_date       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1,
  UNIQUE (application_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_grant_installments_application
  ON disbursement.grant_installments (application_id);

CREATE TABLE IF NOT EXISTS disbursement.grant_disbursements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  installment_id      uuid        NOT NULL,
  amount_minor        bigint      NOT NULL DEFAULT 0,
  currency            char(3)     NOT NULL DEFAULT 'INR',
  mode                varchar(16) NOT NULL DEFAULT 'PFMS'
                        CHECK (mode IN ('PFMS','DBT','cheque','RTGS')),
  pfms_txn_id         text,                     -- PFMS transaction reference for reconciliation
  beneficiary_bank_ref text,                    -- opaque "grant_bank_accounts:UUID"
  status              varchar(24) NOT NULL DEFAULT 'initiated'
                        CHECK (status IN ('initiated','completed','failed')),
  disbursed_at        timestamptz,
  failure_reason      text,
  retry_count         integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grant_disbursements_installment
  ON disbursement.grant_disbursements (installment_id);
CREATE INDEX IF NOT EXISTS idx_grant_disbursements_pfms_txn
  ON disbursement.grant_disbursements (pfms_txn_id) WHERE pfms_txn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS disbursement.grant_pfms_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  disbursement_id uuid        NOT NULL,
  pfms_txn_id     text        NOT NULL,
  reconciled      boolean     NOT NULL DEFAULT false,
  reconciled_at   timestamptz,
  raw_response    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grant_pfms_txn
  ON disbursement.grant_pfms_records (pfms_txn_id);

-- ── utilisation module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS utilisation.grant_uc_statements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  application_id  uuid        NOT NULL,
  period          char(7)     NOT NULL,         -- YYYY-YY or YYYY-MM
  released_minor  bigint      NOT NULL DEFAULT 0,
  utilised_minor  bigint      NOT NULL DEFAULT 0,
  variance_minor  bigint      NOT NULL DEFAULT 0,
  currency        char(3)     NOT NULL DEFAULT 'INR',
  status          varchar(24) NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted','accepted','overdue','rejected')),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  uc_ref          text,                         -- opaque "finance_uc:UUID"
  is_immutable    boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  UNIQUE (application_id, period)
);

CREATE INDEX IF NOT EXISTS idx_grant_uc_application
  ON utilisation.grant_uc_statements (application_id);

CREATE TABLE IF NOT EXISTS utilisation.grant_compliance_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  period         char(7)     NOT NULL,
  kind           varchar(24) NOT NULL DEFAULT 'interim'
                   CHECK (kind IN ('interim','final','special')),
  observation    text,
  status         varchar(24) NOT NULL DEFAULT 'submitted',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS utilisation.grant_audit_paras (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  application_id  uuid        NOT NULL,
  audit_type      varchar(24) NOT NULL DEFAULT 'internal'
                    CHECK (audit_type IN ('statutory','CAG','internal')),
  para_no         text        NOT NULL,
  observation     text        NOT NULL,
  recovery_minor  bigint      NOT NULL DEFAULT 0,
  currency        char(3)     NOT NULL DEFAULT 'INR',
  status          varchar(24) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','replied','settled','dropped')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);

-- ── beneficiary module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS beneficiary.grant_beneficiaries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  name                text        NOT NULL,
  type                varchar(24) NOT NULL DEFAULT 'individual'
                        CHECK (type IN ('individual','institution','society','mission')),
  category            text,                     -- SC | ST | OBC | general | BPL | etc.
  age                 integer,
  income_annual_minor bigint      NOT NULL DEFAULT 0,
  currency            char(3)     NOT NULL DEFAULT 'INR',
  geography           text,                     -- state | district code
  status              varchar(24) NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grant_beneficiaries_tenant
  ON beneficiary.grant_beneficiaries (tenant_id, status);

CREATE TABLE IF NOT EXISTS beneficiary.grant_bank_accounts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  beneficiary_id   uuid        NOT NULL,
  account_no_masked text       NOT NULL,        -- last 4 digits only
  bank_ifsc        varchar(16) NOT NULL,
  bank_name        text,
  npci_linked      boolean     NOT NULL DEFAULT false,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_grant_bank_beneficiary
  ON beneficiary.grant_bank_accounts (beneficiary_id);

-- DPDP §4 compliance: never stores raw Aadhaar — only last 4 digits + SHA-256 token
CREATE TABLE IF NOT EXISTS beneficiary.grant_aadhaar_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  beneficiary_id  uuid        NOT NULL UNIQUE, -- one Aadhaar link per beneficiary
  aadhaar_last4   char(4)     NOT NULL,         -- last 4 digits (display only)
  aadhaar_token   text        NOT NULL,         -- SHA-256(aadhaar + salt) — non-reversible
  npci_bank_ref   text,                         -- opaque "grant_bank_accounts:UUID"
  linked_at       timestamptz NOT NULL DEFAULT now(),
  status          varchar(24) NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);
