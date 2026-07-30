-- 0096_interview_responses.sql
-- Candidate interview self-service responses (checklist R-RA-0143).
--   recruitment.hrms_interview_responses — a candidate CONFIRM (terminal) or a
--   RESCHEDULE_REQUEST (pending → approved/declined by HR). On approval the
--   interview's date/time is moved to the requested slot. At most ONE pending
--   reschedule request per interview at a time.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (recruitment schema).
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_interview_responses;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_interview_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  interview_id   uuid NOT NULL,
  application_id uuid NOT NULL,
  response_type  varchar(20) NOT NULL,
  status         varchar(12) NOT NULL,
  preferred_date date,
  preferred_time varchar(5),
  reason         text,
  from_date      date,
  from_time      varchar(5),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_interview_responses_type_check
    CHECK (response_type IN ('confirm','reschedule_request')),
  CONSTRAINT hrms_interview_responses_status_check
    CHECK (status IN ('confirmed','pending','approved','declined'))
);

CREATE INDEX IF NOT EXISTS hrms_interview_responses_iv_idx
  ON recruitment.hrms_interview_responses (tenant_id, interview_id, created_at);

-- At most one pending reschedule request per interview (DB-level guarantee).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_interview_responses_pending_uq
  ON recruitment.hrms_interview_responses (tenant_id, interview_id) WHERE status = 'pending';

ALTER TABLE recruitment.hrms_interview_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interview_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_interview_responses_tenant_isolation ON recruitment.hrms_interview_responses;
CREATE POLICY hrms_interview_responses_tenant_isolation ON recruitment.hrms_interview_responses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_interview_responses TO hrms_svc;
