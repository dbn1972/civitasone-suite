-- 0045_contract_renewal_workflows.sql  (Contract Renewal Workflows)
-- Creates the `contracts` schema with tables for contract lifecycle management,
-- renewal tracking, notification deduplication, tenant configuration, and sequence counter.
-- Additive + idempotent (IF NOT EXISTS). RLS enabled inline.
--
-- Rollback: DROP SCHEMA IF EXISTS contracts CASCADE;
-- Affected services: hrms-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS contracts;

-- 1. Main contracts table
CREATE TABLE IF NOT EXISTS contracts.hrms_contracts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  employee_id          uuid NOT NULL,
  contract_no          varchar(32) NOT NULL,
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  terms                jsonb NOT NULL DEFAULT '{}'::jsonb,
  renewal_count        integer NOT NULL DEFAULT 0,
  status               varchar(24) NOT NULL DEFAULT 'draft',
  previous_contract_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_contracts_status_check
    CHECK (status IN ('draft','active','expiring','expired','renewed','terminated','escalated'))
);

-- Unique contract number per tenant
--
-- FIXED 2026-07-27: this was `ADD CONSTRAINT IF NOT EXISTS`, which is not valid
-- PostgreSQL — there is no IF NOT EXISTS clause on ADD CONSTRAINT. The statement
-- was a syntax error, so with ON_ERROR_STOP=1 this migration aborted here on
-- every run: the unique constraint, the partial unique index and every lookup
-- index below were never created. Detected by running the bootstrap against a
-- throwaway postgres:16-alpine container; hidden because
-- scripts/ci/bootstrap-postgres.sh warned and continued.
-- Rewritten to the idempotent DO/duplicate_object form used elsewhere in the repo.
DO $$ BEGIN
  ALTER TABLE contracts.hrms_contracts
    ADD CONSTRAINT uq_contracts_tenant_contract_no
    UNIQUE (tenant_id, contract_no);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only one active contract per employee per tenant (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_employee_active
  ON contracts.hrms_contracts (tenant_id, employee_id)
  WHERE status = 'active';

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_employee
  ON contracts.hrms_contracts (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status
  ON contracts.hrms_contracts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_end_date
  ON contracts.hrms_contracts (tenant_id, end_date);

-- 2. Contract renewals table
CREATE TABLE IF NOT EXISTS contracts.hrms_contract_renewals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  contract_id      uuid NOT NULL,
  renewal_number   integer NOT NULL,
  initiated_by     uuid NOT NULL,
  initiated_at     timestamptz NOT NULL DEFAULT now(),
  status           varchar(32) NOT NULL DEFAULT 'pending_approval',
  new_end_date     date NOT NULL,
  original_terms   jsonb NOT NULL,
  new_terms        jsonb NOT NULL,
  approval_chain   jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by      uuid,
  approved_at      timestamptz,
  rejected_by      uuid,
  rejected_at      timestamptz,
  rejection_reason text,
  budget_ref       varchar(64),
  new_contract_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_contract_renewals_status_check
    CHECK (status IN ('pending_approval','approved','rejected','budget_insufficient','cancelled'))
);

-- Only one pending renewal per contract per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_renewals_contract_pending
  ON contracts.hrms_contract_renewals (tenant_id, contract_id)
  WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_renewals_tenant_contract
  ON contracts.hrms_contract_renewals (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_renewals_tenant_status
  ON contracts.hrms_contract_renewals (tenant_id, status);

-- 3. Notification deduplication table
CREATE TABLE IF NOT EXISTS contracts.hrms_contract_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  contract_id uuid NOT NULL,
  milestone   integer NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notifications_milestone UNIQUE (tenant_id, contract_id, milestone)
);

-- 4. Tenant contract configuration
CREATE TABLE IF NOT EXISTS contracts.hrms_contract_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL UNIQUE,
  reminder_milestones     jsonb NOT NULL DEFAULT '[90, 60, 30, 15, 7]'::jsonb,
  approval_chain          jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_separation_enabled boolean NOT NULL DEFAULT true,
  scheduler_time_utc      varchar(5) NOT NULL DEFAULT '02:00',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1
);

-- 5. Contract number sequence counter
CREATE TABLE IF NOT EXISTS contracts.hrms_contract_seq (
  tenant_id uuid PRIMARY KEY,
  next_val  integer NOT NULL DEFAULT 1
);

-- RLS policies
ALTER TABLE contracts.hrms_contracts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_renewals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_seq           ENABLE ROW LEVEL SECURITY;

ALTER TABLE contracts.hrms_contracts              FORCE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_renewals      FORCE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_config        FORCE ROW LEVEL SECURITY;
ALTER TABLE contracts.hrms_contract_seq           FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_contracts ON contracts.hrms_contracts
  USING (tenant_id = current_setting('app.tenant_id', false)::uuid);
CREATE POLICY tenant_isolation_renewals ON contracts.hrms_contract_renewals
  USING (tenant_id = current_setting('app.tenant_id', false)::uuid);
CREATE POLICY tenant_isolation_notifications ON contracts.hrms_contract_notifications
  USING (tenant_id = current_setting('app.tenant_id', false)::uuid);
CREATE POLICY tenant_isolation_config ON contracts.hrms_contract_config
  USING (tenant_id = current_setting('app.tenant_id', false)::uuid);
CREATE POLICY tenant_isolation_seq ON contracts.hrms_contract_seq
  USING (tenant_id = current_setting('app.tenant_id', false)::uuid);

-- Privileges: runtime role (hrms_svc, NOBYPASSRLS) needs access to new schema
GRANT USAGE ON SCHEMA contracts TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA contracts TO hrms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA contracts
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_svc;
