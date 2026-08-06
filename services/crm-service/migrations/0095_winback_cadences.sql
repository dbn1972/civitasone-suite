-- G9: Win-back cadence engine — structured re-engagement for at-risk accounts.
-- Accounts with declining transactions after a complaint enter a monitored cadence;
-- outcomes (converted, churned, no_response) are tracked for effectiveness reporting.
-- Rollback: DROP TABLE IF EXISTS crm.winback_enrollments; DROP TABLE IF EXISTS crm.winback_cadences;
SET lock_timeout = '5s';

-- ── Cadence definitions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm.winback_cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  trigger_criteria jsonb NOT NULL DEFAULT '{}',
  steps jsonb NOT NULL DEFAULT '[]',
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_winback_cadences_tenant
  ON crm.winback_cadences (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_winback_cadences_active
  ON crm.winback_cadences (tenant_id) WHERE status = 'active';

ALTER TABLE crm.winback_cadences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'winback_cadences' AND policyname = 'tenant_isolation_winback_cadences'
  ) THEN
    CREATE POLICY tenant_isolation_winback_cadences ON crm.winback_cadences
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- ── Enrollment records ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm.winback_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cadence_id uuid NOT NULL REFERENCES crm.winback_cadences(id),
  account_id uuid NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  current_step integer NOT NULL DEFAULT 0,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'converted')),
  outcome varchar(16) CHECK (outcome IS NULL OR outcome IN ('converted', 'churned', 'no_response')),
  converted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_winback_enrollments_tenant
  ON crm.winback_enrollments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_winback_enrollments_account
  ON crm.winback_enrollments (tenant_id, account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_winback_enrollments_cadence
  ON crm.winback_enrollments (tenant_id, cadence_id) WHERE status = 'active';

ALTER TABLE crm.winback_enrollments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'winback_enrollments' AND policyname = 'tenant_isolation_winback_enrollments'
  ) THEN
    CREATE POLICY tenant_isolation_winback_enrollments ON crm.winback_enrollments
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
