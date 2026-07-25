-- Purpose: CAP-054 webhook lifecycle — delivery state machine, duplicate
--          protection (dedup), replay, and HMAC secret rotation (maker-checker).
-- Idempotent: additive ALTERs + CREATE TABLE/INDEX IF NOT EXISTS.
-- Affected services: admin-service (webhooks module).
-- RLS: webhook_deliveries gains tenant_id + FORCE RLS; secret_rotations is
--      tenant-scoped with FORCE RLS. Mirrors migration 0006/0013 conventions
--      (current_tenant_id() GUC + tenant_isolation_policy).
-- Rollback:
--   ALTER TABLE webhooks.webhooks DROP COLUMN IF EXISTS previous_secret, DROP COLUMN IF EXISTS secret_rotated_at;
--   DROP TABLE IF EXISTS webhooks.secret_rotations;
--   (delivery lifecycle columns left in place — additive, non-breaking.)
SET lock_timeout = '5s';

-- ── webhooks.webhooks: secret rotation grace window ─────────────────────────
ALTER TABLE webhooks.webhooks ADD COLUMN IF NOT EXISTS previous_secret   text;
ALTER TABLE webhooks.webhooks ADD COLUMN IF NOT EXISTS secret_rotated_at timestamptz;

-- ── webhooks.webhook_deliveries: lifecycle + dedup + replay ─────────────────
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS tenant_id    uuid;
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS event_id     uuid;
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS status       varchar(20) NOT NULL DEFAULT 'delivered';
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS max_attempts integer     NOT NULL DEFAULT 5;
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS last_error   text;
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS signature    text;
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS replay_of    uuid;
ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

-- Backfill tenant_id from the parent webhook for any pre-existing rows.
UPDATE webhooks.webhook_deliveries d
   SET tenant_id = w.tenant_id
  FROM webhooks.webhooks w
 WHERE d.webhook_id = w.id AND d.tenant_id IS NULL;

DO $$ BEGIN
  ALTER TABLE webhooks.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_status_chk CHECK (status IN
      ('pending','delivering','delivered','failed','exhausted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Duplicate protection: at most one live (non-replay) delivery per source event
-- per endpoint. Replays (replay_of IS NOT NULL) are intentionally exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_dedup
  ON webhooks.webhook_deliveries (webhook_id, event_id)
  WHERE event_id IS NOT NULL AND replay_of IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON webhooks.webhook_deliveries (next_retry_at)
  WHERE status IN ('pending','failed');

-- FORCE RLS now that deliveries carry tenant_id.
ALTER TABLE webhooks.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks.webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON webhooks.webhook_deliveries;
CREATE POLICY tenant_isolation_policy ON webhooks.webhook_deliveries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── webhooks.secret_rotations: maker-checker HMAC secret rotation ───────────
CREATE TABLE IF NOT EXISTS webhooks.secret_rotations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  webhook_id     uuid NOT NULL REFERENCES webhooks.webhooks(id) ON DELETE CASCADE,
  new_secret     text NOT NULL,
  status         varchar(20) NOT NULL DEFAULT 'pending',
  reason         text,
  requested_by   uuid NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid,
  decided_at     timestamptz,
  correlation_id varchar(64),
  CONSTRAINT secret_rotations_status_chk CHECK (status IN ('pending','approved','rejected')),
  -- maker-checker: the approver/rejecter must differ from the requester.
  CONSTRAINT secret_rotations_maker_checker_chk CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_secret_rotations_tenant_status
  ON webhooks.secret_rotations (tenant_id, status);
-- Only one pending rotation per webhook at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_secret_rotations_pending
  ON webhooks.secret_rotations (webhook_id)
  WHERE status = 'pending';

ALTER TABLE webhooks.secret_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks.secret_rotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON webhooks.secret_rotations;
CREATE POLICY tenant_isolation_policy ON webhooks.secret_rotations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
