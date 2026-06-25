-- legal-service: legal opinions domain (sought -> drafted -> issued), tied to a case
CREATE SCHEMA IF NOT EXISTS opinions;

CREATE TABLE IF NOT EXISTS opinions.legal_opinions (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL,
  case_id       uuid,
  opinion_no    text         NOT NULL,
  subject       text         NOT NULL,
  question      text         NOT NULL,
  sought_by     text,
  counsel_name  text,
  opinion_text  text,
  status        varchar(24)  NOT NULL DEFAULT 'sought',
  sought_at     timestamptz  NOT NULL DEFAULT now(),
  drafted_at    timestamptz,
  issued_at     timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, opinion_no)
);

CREATE INDEX IF NOT EXISTS idx_op_legal_opinions_tenant_status ON opinions.legal_opinions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_op_legal_opinions_case ON opinions.legal_opinions (tenant_id, case_id);
