-- 0099_otp_challenges.sql
-- OTP verification challenges for candidate applications (DEF-RC-003 / R-RA-0077).
--   candidate.hrms_candidate_otp_challenges — stores the generated OTP code, expiry,
--   attempts, and verification state. One active challenge per (tenant, candidate,
--   channel) at a time. FORCE RLS on app.tenant_id GUC.
-- Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS candidate.hrms_candidate_otp_challenges;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  channel      varchar(8) NOT NULL,
  code         varchar(6) NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  verified     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_otp_challenges_channel_check CHECK (channel IN ('email','sms'))
);

CREATE INDEX IF NOT EXISTS hrms_otp_challenges_cand_idx
  ON candidate.hrms_candidate_otp_challenges (tenant_id, candidate_id, channel);

ALTER TABLE candidate.hrms_candidate_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate.hrms_candidate_otp_challenges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_otp_challenges_tenant_isolation ON candidate.hrms_candidate_otp_challenges;
CREATE POLICY hrms_otp_challenges_tenant_isolation ON candidate.hrms_candidate_otp_challenges
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON candidate.hrms_candidate_otp_challenges TO hrms_svc;
