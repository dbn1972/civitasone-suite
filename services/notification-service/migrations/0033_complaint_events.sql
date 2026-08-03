-- Purpose: P1-3 — give a spam complaint somewhere to land.
--
--          `chk_suppression_list_reason` (0026) has always permitted
--          reason = 'complaint' and source = 'complaint', but NO code path in
--          the service could ever produce one: there was no route, no command,
--          no consumer and no table. A recipient who pressed "report spam" was
--          therefore never suppressed and kept receiving mail — the exact
--          failure that gets a sending domain blocklisted (SES suspends a
--          sender above a 0.1% complaint rate) and, under DPDP, ignores a
--          withdrawal of consent.
--
--          A complaint is NOT a bounce and deliberately does not share
--          bounces.bounce_events: `classification` there is constrained to
--          ('hard','soft','unknown') and carries the invariant "unknown never
--          suppresses". A complaint has no classification and no threshold —
--          it is always terminal — so widening that column would have blurred a
--          load-bearing rule. `feedback_type` instead records the RFC 5965 ARF
--          type the ESP reported, which is diagnostic, never a gate.
--
--          The complaint rows also give the deliverability module an honest
--          complaint-rate denominator, which is the number ESPs actually police.
--
-- Rollback: DROP TABLE IF EXISTS bounces.complaint_events;
--           (suppression rows already written with source='complaint' survive
--           and stay valid — 0026's CHECK permits them. Release them with
--           DELETE /v1/notification/suppressions/:id if the rollback is meant
--           to restore delivery.)
--
-- Affected services: notification-service (bounces module)
--
-- Safety: purely additive — one new table, no existing column, constraint or
-- index is altered, so no deployed code can break and no row can become
-- invalid. Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS, and
-- ADD CONSTRAINT (which has no IF NOT EXISTS) is guarded on pg_constraint —
-- `scripts/dev/migrate-all.mjs` keeps no applied-migration ledger and re-runs
-- every file, so a re-run must be a no-op. CREATE INDEX is NOT concurrent here
-- because the table is empty at creation, which makes a blocking build
-- instantaneous and keeps the whole file inside one transaction.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS bounces.complaint_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  -- No FK: deliveries.deliveries lives in another module schema, and a
  -- complaint can arrive after retention has removed the delivery row.
  delivery_id    uuid,
  -- PII: written through encryptedText() (AES-256-GCM). Never logged, never
  -- returned in a response body.
  recipient      text NOT NULL,
  -- Keyed HMAC blind index. Every lookup goes through this, never through the
  -- non-deterministic ciphertext above.
  recipient_hash text NOT NULL,
  channel        varchar(32) NOT NULL DEFAULT 'email',
  -- RFC 5965 §7.3 feedback-type. Recorded for diagnostics and reporting only:
  -- every value below means "this recipient does not want our mail", so none of
  -- them changes the suppression decision.
  feedback_type  varchar(32) NOT NULL DEFAULT 'abuse',
  reason         text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_complaint_events_feedback_type') THEN
    ALTER TABLE bounces.complaint_events
      ADD CONSTRAINT chk_complaint_events_feedback_type
      CHECK (feedback_type IN ('abuse', 'fraud', 'virus', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_complaint_events_channel') THEN
    ALTER TABLE bounces.complaint_events
      ADD CONSTRAINT chk_complaint_events_channel
      CHECK (channel IN ('email', 'sms', 'whatsapp', 'push'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_complaint_events_version') THEN
    ALTER TABLE bounces.complaint_events
      ADD CONSTRAINT chk_complaint_events_version CHECK (version >= 1);
  END IF;
END
$$;

-- countComplaints(): WHERE tenant_id = $1 AND recipient_hash = $2
CREATE INDEX IF NOT EXISTS idx_complaint_events_tenant_hash
  ON bounces.complaint_events (tenant_id, recipient_hash);
-- Complaint-rate reporting reads a tenant's recent window.
CREATE INDEX IF NOT EXISTS idx_complaint_events_tenant_occurred
  ON bounces.complaint_events (tenant_id, occurred_at DESC);

ALTER TABLE bounces.complaint_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounces.complaint_events FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'bounces'
      AND tablename  = 'complaint_events'
      AND policyname = 'tenant_isolation_policy'
  ) THEN
    CREATE POLICY tenant_isolation_policy ON bounces.complaint_events
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END
$$;

-- Grants — guarded on pg_roles so this file applies cleanly to a database where
-- the service roles have not been provisioned yet (fresh installer run, CI).
-- No role is created here. 0026 already set ALTER DEFAULT PRIVILEGES on the
-- bounces schema, but that only covers tables created by the role that ran it,
-- so the grant is repeated explicitly rather than assumed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bounces.complaint_events TO notification_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_scanner') THEN
    GRANT SELECT ON bounces.complaint_events TO notification_scanner;
  END IF;
END
$$;

COMMENT ON TABLE bounces.complaint_events IS
  'Spam/abuse complaints relayed by an ESP feedback loop (RFC 5965 ARF). Every row suppresses the recipient immediately — unlike a bounce there is no threshold and no ambiguous classification.';
COMMENT ON COLUMN bounces.complaint_events.feedback_type IS
  'RFC 5965 feedback-type: abuse | fraud | virus | other. Diagnostic only — all four suppress.';
