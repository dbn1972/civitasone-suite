-- 0076_selection_offer.sql
-- Selection & offer (checklist R-RA-0155/0156/0158/0161/0163/0164).
--   • hrms_offers gains a compensation breakdown, an approval chain + stage, the
--     candidate response (accept/decline with reason + acceptance metadata),
--     release/expiry, and version-history links (offer_no + offer_version +
--     supersedes_offer_id) so revisions are tracked.
--   • hrms_offer_events is the immutable offer lifecycle audit trail.
-- Additive + idempotent. No status CHECK is added — the legacy async offer path
-- writes status 'sent'; transitions are enforced in application code.
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_offer_events;
--           ALTER TABLE recruitment.hrms_offers DROP COLUMN IF EXISTS offer_no, ...;

ALTER TABLE recruitment.hrms_offers
  ADD COLUMN IF NOT EXISTS offer_no            varchar(48),
  ADD COLUMN IF NOT EXISTS offer_version       integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS basic_minor         bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS joining_bonus_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relocation_minor    bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variable_pay_minor  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_ctc_minor     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grade               varchar(48),
  ADD COLUMN IF NOT EXISTS template_ref        varchar(200),
  ADD COLUMN IF NOT EXISTS approval_chain      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_stage       integer NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS released_at         timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at          date,
  ADD COLUMN IF NOT EXISTS accepted_at         timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_version    integer,
  ADD COLUMN IF NOT EXISTS acceptance_meta     jsonb,
  ADD COLUMN IF NOT EXISTS declined_at         timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason_code varchar(24),
  ADD COLUMN IF NOT EXISTS decline_remarks     text,
  ADD COLUMN IF NOT EXISTS withdraw_reason     text,
  ADD COLUMN IF NOT EXISTS supersedes_offer_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS hrms_offers_no_uq
  ON recruitment.hrms_offers (tenant_id, offer_no) WHERE offer_no IS NOT NULL;
-- Enforce version uniqueness for the NEW lifecycle offers (offer_no set) so a
-- concurrent create/revise cannot mint two rows at the same offer_version for one
-- application. Legacy async offers (offer_no NULL, status 'sent') are exempt, so
-- the old path still coexists; new offers sequence AFTER legacy ones because
-- maxOfferVersion counts all rows for the application.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_offers_app_version_uq
  ON recruitment.hrms_offers (tenant_id, application_id, offer_version)
  WHERE offer_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS recruitment.hrms_offer_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  offer_id       uuid NOT NULL,
  application_id uuid NOT NULL,
  action         varchar(16) NOT NULL,          -- submit|approve|return|release|accept|decline|withdraw|expire|revise
  reason_code    varchar(24),
  remarks        text,
  actor_id       uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_offer_events_action_check
    CHECK (action IN ('submit','approve','return','release','accept','decline','withdraw','expire','revise'))
);
CREATE INDEX IF NOT EXISTS hrms_offer_events_offer_idx
  ON recruitment.hrms_offer_events (tenant_id, offer_id, created_at);

-- RLS (FORCE, app.tenant_id GUC).
ALTER TABLE recruitment.hrms_offer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_offer_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_offer_events_tenant_isolation ON recruitment.hrms_offer_events;
CREATE POLICY hrms_offer_events_tenant_isolation ON recruitment.hrms_offer_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_offer_events TO hrms_svc;
