-- Purpose: Add obligations, renewals, and approval_levels schemas/tables
-- Rollback: DROP SCHEMA obligations CASCADE; DROP SCHEMA renewals CASCADE; DROP SCHEMA approvals CASCADE;
-- Affected services: contract-service

SET lock_timeout = '5s';

-- ── Obligations Schema ──────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS obligations;

CREATE TABLE IF NOT EXISTS obligations.contract_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue')),
  owner_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligations_tenant_id
  ON obligations.contract_obligations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligations_contract_id
  ON obligations.contract_obligations (contract_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligations_due_date
  ON obligations.contract_obligations (due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligations_status
  ON obligations.contract_obligations (status);

ALTER TABLE obligations.contract_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations.contract_obligations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'contract_obligations' AND schemaname = 'obligations' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON obligations.contract_obligations
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS obligations.obligation_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  obligation_id UUID NOT NULL REFERENCES obligations.contract_obligations(id),
  reminder_date DATE NOT NULL,
  days_before INT NOT NULL,
  sent VARCHAR(10) NOT NULL DEFAULT 'pending'
    CHECK (sent IN ('pending', 'sent')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligation_reminders_obligation_id
  ON obligations.obligation_reminders (obligation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligation_reminders_tenant_id
  ON obligations.obligation_reminders (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obligation_reminders_date_sent
  ON obligations.obligation_reminders (reminder_date, sent);

ALTER TABLE obligations.obligation_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations.obligation_reminders FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'obligation_reminders' AND schemaname = 'obligations' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON obligations.obligation_reminders
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ── Renewals Schema ─────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS renewals;

CREATE TABLE IF NOT EXISTS renewals.contract_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contract_id UUID NOT NULL,
  expiry_date DATE NOT NULL,
  advance_notice_days INT NOT NULL DEFAULT 30
    CHECK (advance_notice_days >= 7 AND advance_notice_days <= 180),
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'renewed', 'expired', 'cancelled')),
  renewed_at TIMESTAMPTZ,
  renewed_by UUID,
  notified_at TIMESTAMPTZ,
  final_reminder_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_renewals_tenant_id
  ON renewals.contract_renewals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_renewals_contract_id
  ON renewals.contract_renewals (contract_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_renewals_expiry_date
  ON renewals.contract_renewals (expiry_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_renewals_status
  ON renewals.contract_renewals (status);

ALTER TABLE renewals.contract_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewals.contract_renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'contract_renewals' AND schemaname = 'renewals' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON renewals.contract_renewals
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ── Approvals Schema ────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS approvals;

CREATE TABLE IF NOT EXISTS approvals.approval_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  min_value_paise BIGINT NOT NULL,
  required_role VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL DEFAULT '',
  ordinal INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_levels_tenant_id
  ON approvals.approval_levels (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_levels_min_value
  ON approvals.approval_levels (tenant_id, min_value_paise);

ALTER TABLE approvals.approval_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals.approval_levels FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'approval_levels' AND schemaname = 'approvals' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON approvals.approval_levels
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
