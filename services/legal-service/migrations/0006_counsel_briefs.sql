-- legal-service: counsel brief assignment (assign counsel + brief to a case / hearing)
CREATE SCHEMA IF NOT EXISTS counsel;

CREATE TABLE IF NOT EXISTS counsel.legal_counsel_briefs (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL,
  case_id       uuid         NOT NULL,
  hearing_id    uuid,
  counsel_name  text         NOT NULL,
  counsel_type  varchar(24)  NOT NULL DEFAULT 'advocate',
  brief_summary text         NOT NULL,
  fee_minor     bigint       NOT NULL DEFAULT 0,
  currency      char(3)      NOT NULL DEFAULT 'INR',
  status        varchar(24)  NOT NULL DEFAULT 'assigned',
  assigned_at   timestamptz  NOT NULL DEFAULT now(),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cb_case ON counsel.legal_counsel_briefs (tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_cb_status ON counsel.legal_counsel_briefs (tenant_id, status);
