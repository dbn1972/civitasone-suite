-- legal-service opinions module

CREATE TABLE IF NOT EXISTS hearings.legal_opinions (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL,
  opinion_no   text         NOT NULL,
  subject      text         NOT NULL,
  requested_by text         NOT NULL,
  request_date date         NOT NULL,
  due_date     date,
  advisor_name text,
  status       varchar(24)  NOT NULL DEFAULT 'pending',
  issued_date  date,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, opinion_no)
);

CREATE INDEX IF NOT EXISTS idx_legal_opinions_tenant ON hearings.legal_opinions (tenant_id, status);
