-- legal-service: court filings / affidavits recorded against a case
CREATE SCHEMA IF NOT EXISTS filings;

CREATE TABLE IF NOT EXISTS filings.legal_filings (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL,
  case_id       uuid         NOT NULL,
  filing_type   varchar(32)  NOT NULL,
  title         text         NOT NULL,
  court         text         NOT NULL,
  filing_date   date         NOT NULL,
  reference_no  text,
  status        varchar(24)  NOT NULL DEFAULT 'drafted',
  filed_at      timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_fil_case ON filings.legal_filings (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_fil_status ON filings.legal_filings (tenant_id, status);
