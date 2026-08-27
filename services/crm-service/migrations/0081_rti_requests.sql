-- RTI Act 2005 module — crm.rti_requests table.
-- RTI request lifecycle: RECEIVED → TRANSFERRED → RESPONDED/REJECTED → FIRST_APPEAL → SECOND_APPEAL → DISPOSED.
-- Rollback: DROP TABLE IF EXISTS crm.rti_requests;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.rti_requests (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  reference_no        text         UNIQUE NOT NULL,
  section             text         NOT NULL
                      CHECK (section IN ('s.6', 's.11')),
  department_ref      text         NOT NULL,
  applicant_name      text         NOT NULL,
  applicant_contact   text,
  subject             text         NOT NULL,
  description         text         NOT NULL,
  fee_paid            boolean      NOT NULL DEFAULT false,
  fee_amount          numeric(10,2),
  received_at         timestamptz  NOT NULL DEFAULT now(),
  due_at              timestamptz  NOT NULL
                      -- Plain `timestamptz + interval '30 days'` is rejected here:
                      -- adding a days-component interval to a timestamptz depends on
                      -- the session's TimeZone GUC (DST/calendar conversion), so
                      -- Postgres classifies the operator STABLE, not IMMUTABLE, and
                      -- generated-column expressions require IMMUTABLE. Round-tripping
                      -- through a fixed literal zone ('UTC', which has no DST) pins the
                      -- calculation to a constant, satisfying IMMUTABLE.
                      -- NOT a universally identical instant to plain `+ interval '30
                      -- days'`: verified on real Postgres 16 that the two match exactly
                      -- under a non-DST session zone (this platform's IST, or UTC), but
                      -- diverge by 1 hour under a DST-observing session zone whose 30-day
                      -- window crosses a transition (e.g. America/New_York). Acceptable
                      -- here — India has no DST — but this expression is not portable to
                      -- a DST timezone without re-deriving it.
                      GENERATED ALWAYS AS (
                        ((received_at AT TIME ZONE 'UTC') + interval '30 days') AT TIME ZONE 'UTC'
                      ) STORED,
  first_appeal_due_at timestamptz,
  status              text         NOT NULL DEFAULT 'RECEIVED'
                      CHECK (status IN (
                        'RECEIVED','TRANSFERRED','RESPONDED','REJECTED',
                        'FIRST_APPEAL','SECOND_APPEAL','DISPOSED'
                      )),
  responded_at        timestamptz,
  response_text       text,
  created_by          uuid         NOT NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rti_requests_tenant_status
  ON crm.rti_requests (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rti_requests_tenant_due
  ON crm.rti_requests (tenant_id, due_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rti_requests_ref
  ON crm.rti_requests (reference_no);

ALTER TABLE crm.rti_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rti_requests' AND policyname = 'tenant_isolation_rti_requests'
  ) THEN
    CREATE POLICY tenant_isolation_rti_requests ON crm.rti_requests
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
