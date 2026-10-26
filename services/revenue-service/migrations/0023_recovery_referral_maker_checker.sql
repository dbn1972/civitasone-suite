-- revenue-service: maker-checker on recovery referrals + demand notices
-- Purpose: Owner decision #4 (2026-10-26, GAP-REVENUE-RECOVERY-01). A coercive
--          recovery referral is a maker-checker action and is allowed only after
--          a demand notice has been SERVED and its notice period has LAPSED.
--          * arrears.demand_notices records each served notice (served_on +
--            notice_period_days; the period is entered per notice by the officer
--            who serves it - no statutory default is assumed).
--          * arrears.recovery_referrals gains the checker columns, the notice the
--            referral relied on, and `pending` as the default status. Rows that
--            already exist keep their status (`referred`/`accepted`/`resolved`).
-- Rollback: DROP TABLE arrears.demand_notices;
--           ALTER TABLE arrears.recovery_referrals DROP COLUMN notice_id, DROP COLUMN checker_user_id,
--             DROP COLUMN decided_at, DROP COLUMN decision_reason;
--           ALTER TABLE arrears.recovery_referrals ALTER COLUMN status SET DEFAULT 'referred';
-- Affected services: revenue-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS arrears.demand_notices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  assessee_id         uuid NOT NULL,
  demand_id           uuid,
  notice_no           varchar(64) NOT NULL,
  served_on           date NOT NULL,
  notice_period_days  integer NOT NULL CHECK (notice_period_days BETWEEN 1 AND 365),
  served_by           uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_demand_notices_tenant_no UNIQUE (tenant_id, notice_no)
);

CREATE INDEX IF NOT EXISTS idx_demand_notices_tenant_assessee
  ON arrears.demand_notices (tenant_id, assessee_id, served_on);

ALTER TABLE arrears.demand_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrears.demand_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON arrears.demand_notices;
CREATE POLICY tenant_isolation ON arrears.demand_notices
  USING      (tenant_id = rates.current_tenant_id())
  WITH CHECK (tenant_id = rates.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON arrears.demand_notices TO revenue_svc;

ALTER TABLE arrears.recovery_referrals
  ADD COLUMN IF NOT EXISTS notice_id       uuid,
  ADD COLUMN IF NOT EXISTS checker_user_id uuid,
  ADD COLUMN IF NOT EXISTS decided_at      timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;

ALTER TABLE arrears.recovery_referrals ALTER COLUMN status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_recovery_referrals_tenant_status
  ON arrears.recovery_referrals (tenant_id, status, referred_at DESC);
