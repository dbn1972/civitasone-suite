-- 0095_interview_comms.sql
-- Interview communications lifecycle (checklist R-RA-0142).
--   recruitment.hrms_interview_comms — append-only log of each candidate comm
--   (invite/reminder/reschedule/cancel), the channel used and whether it was
--   queued to the outbox (feature flag on) or recorded as a stub (flag off).
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (recruitment schema).
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_interview_comms;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_interview_comms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  interview_id   uuid NOT NULL,
  application_id uuid NOT NULL,
  comm_type      varchar(12) NOT NULL,
  channel        varchar(8) NOT NULL,
  status         varchar(10) NOT NULL,
  message        text NOT NULL,
  scheduled_for  timestamptz,
  idempotency_key varchar(64),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  CONSTRAINT hrms_interview_comms_type_check
    CHECK (comm_type IN ('invite','reminder','reschedule','cancel')),
  CONSTRAINT hrms_interview_comms_channel_check
    CHECK (channel IN ('email','sms','stub')),
  CONSTRAINT hrms_interview_comms_status_check
    CHECK (status IN ('queued','stubbed'))
);

CREATE INDEX IF NOT EXISTS hrms_interview_comms_iv_idx
  ON recruitment.hrms_interview_comms (tenant_id, interview_id, created_at);

-- Idempotency: a client-supplied key dedupes retries so a comm (and its outbox
-- dispatch) is not sent twice. Partial unique index — only keyed rows are guarded.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_interview_comms_idem_uq
  ON recruitment.hrms_interview_comms (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE recruitment.hrms_interview_comms ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interview_comms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_interview_comms_tenant_isolation ON recruitment.hrms_interview_comms;
CREATE POLICY hrms_interview_comms_tenant_isolation ON recruitment.hrms_interview_comms
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_interview_comms TO hrms_svc;
