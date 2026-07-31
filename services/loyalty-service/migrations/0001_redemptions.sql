-- 0001_redemptions.sql
-- Purpose: Create the loyalty.redemptions table for point redemption tracking.
-- Affected services: loyalty-service
--
-- Rollback:
--   DROP TABLE IF EXISTS loyalty.redemptions;
--   DROP SCHEMA IF EXISTS loyalty;

SET lock_timeout = '5s';

-- ── Schema ─────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS loyalty;

-- ── Redemptions table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty.redemptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  member_id      uuid NOT NULL,
  points         bigint NOT NULL,
  reward_type    varchar(50) NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'pending',
  redeemed_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT loyalty_redemptions_points_positive CHECK (points > 0),
  CONSTRAINT loyalty_redemptions_status_check CHECK (status IN ('pending','fulfilled','cancelled','expired'))
);

CREATE INDEX IF NOT EXISTS loyalty_redemptions_tenant_member_idx
  ON loyalty.redemptions (tenant_id, member_id);

CREATE INDEX IF NOT EXISTS loyalty_redemptions_tenant_status_idx
  ON loyalty.redemptions (tenant_id, status);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE loyalty.redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.redemptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_redemptions_tenant_isolation ON loyalty.redemptions;
CREATE POLICY loyalty_redemptions_tenant_isolation ON loyalty.redemptions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $grant$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty_svc') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty.redemptions TO loyalty_svc; END IF; END $grant$;
