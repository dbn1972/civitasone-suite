-- Gap 2: Referral-Outcome Reconciliation — referrals table.
-- Rollback: DROP TABLE IF EXISTS crm.referrals;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referrer_id uuid NOT NULL,
  referred_contact_id uuid NOT NULL,
  source_system varchar(64),
  external_ref varchar(200),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'expired', 'rejected')),
  conversion_deal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  credited boolean NOT NULL DEFAULT false
);

-- Dedup: no double credit per (tenant, referrer, contact).
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_dedup
  ON crm.referrals (tenant_id, referrer_id, referred_contact_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referrals_tenant
  ON crm.referrals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referrals_external
  ON crm.referrals (tenant_id, external_ref) WHERE external_ref IS NOT NULL;

ALTER TABLE crm.referrals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'referrals' AND policyname = 'tenant_isolation_referrals'
  ) THEN
    CREATE POLICY tenant_isolation_referrals ON crm.referrals
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
