-- Purpose: Create crm.onboarding_cases — the customer onboarding raised when a deal is
--          won, progressing through a fixed stage sequence behind a KYC gate (P1-9).
--          Onboarding was absent entirely: a won deal left no record of the work needed
--          to take the customer live, and nothing stopped an account being marked
--          onboarded before KYC verification had passed.
-- Rollback: DROP TABLE IF EXISTS crm.onboarding_cases;
-- Affected services: crm-service
-- Sequencing: additive — a new table with no foreign keys into existing tables, so it is
--             safe to apply before the code that writes it.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.onboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Opaque ids into the deals / accounts domains. No cross-module foreign key by
  -- design (CLAUDE.md §3.13) — the case must stay extractable on its own.
  deal_id uuid NOT NULL,
  account_id uuid,
  stage varchar(24) NOT NULL DEFAULT 'initiated'
    CHECK (stage IN ('initiated', 'documents_submitted', 'verification', 'provisioning', 'completed', 'cancelled')),
  kyc_status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (kyc_status IN ('pending', 'submitted', 'verified', 'rejected')),
  -- Opaque reference issued by the KYC provider — never the underlying documents or
  -- identifiers themselves (DPDP).
  kyc_reference varchar(120),
  kyc_verified_at timestamptz,
  completed_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  -- The KYC gate as a table invariant. The route rejects a premature completion with
  -- 422 and the consumer's UPDATE is guarded on kyc_status, but neither of those
  -- survives a hand-run SQL fix; this constraint does.
  CONSTRAINT onboarding_cases_kyc_gate CHECK (stage <> 'completed' OR kyc_status = 'verified')
);

-- One onboarding case per won deal. This is also what makes the deal-won trigger safe
-- to replay: the consumer inserts ON CONFLICT DO NOTHING against this index.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_onboarding_cases_deal
  ON crm.onboarding_cases(tenant_id, deal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_onboarding_cases_tenant_stage
  ON crm.onboarding_cases(tenant_id, stage);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_onboarding_cases_account
  ON crm.onboarding_cases(tenant_id, account_id) WHERE account_id IS NOT NULL;

ALTER TABLE crm.onboarding_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.onboarding_cases FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'onboarding_cases_tenant_isolation' AND tablename = 'onboarding_cases'
  ) THEN
    CREATE POLICY onboarding_cases_tenant_isolation ON crm.onboarding_cases
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.onboarding_cases TO crm_svc;
  END IF;
END $g$;
