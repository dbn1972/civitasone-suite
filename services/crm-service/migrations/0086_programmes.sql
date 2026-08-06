-- Purpose: G12 (Spec §25.7, Journey J6 — Government Programme Account Management).
--   crm.programmes is the first-class government PROGRAMME / ENGAGEMENT entity that
--   opportunities, revenue and SLA reporting hang off. Before this table there was
--   nothing in crm-service to "register an opportunity under the Government product
--   line with programme metadata" against — the journey had no anchor object.
--
--   A programme is owned by an account (the client department), optionally references a
--   contract in contract-service (opaque id — NO cross-service FK, database-per-service),
--   and carries the coverage scope it is executed over (regions / districts) as jsonb so
--   a state-wide programme and a three-district pilot are the same shape.
--
--   programme_code is the stable machine key tenants use in their own systems and in
--   downstream reporting; it is UNIQUE per tenant so two teams cannot register the same
--   programme twice and split its metrics.
--
-- Rollback:
--   DROP INDEX IF EXISTS crm.uq_programmes_code;
--   DROP INDEX IF EXISTS crm.idx_programmes_account;
--   DROP INDEX IF EXISTS crm.idx_programmes_tenant_status;
--   DROP TABLE IF EXISTS crm.programmes;
--   (No other table references crm.programmes, so the drop is self-contained.)
--
-- Affected services: crm-service (programmes module) only. Emits crm.programme.*
--   events consumed by audit-service via the shared outbox relay; no schema change is
--   required in any other service to receive them.
--
-- Sequencing: additive — new tenant-scoped table, no destructive change, safe to
--   re-run (IF NOT EXISTS throughout).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Stable machine key (e.g. 'PMAY-U-2026'). Uppercased by the application before the
  -- write so 'pmay-u' and 'PMAY-U' cannot both be registered.
  programme_code varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  -- The client department. Opaque within this migration: crm.accounts lives in the same
  -- schema but the module does not join to it, it only records what the caller asserted.
  account_id uuid NOT NULL,
  -- Opaque reference into contract-service. Nullable: a programme is commonly registered
  -- during pursuit, before any contract exists.
  contract_id uuid,
  product_line varchar(64) NOT NULL DEFAULT 'government',
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'suspended', 'closed')),
  start_date date,
  end_date date,
  sponsoring_department varchar(200),
  -- Execution coverage, e.g. { "regions": ["MH"], "districts": ["Pune","Nashik"] }.
  -- jsonb (not a child table) because coverage is read whole, never queried across
  -- programmes, and its shape differs per tenant.
  coverage_scope jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  -- A programme that ends before it starts is a data-entry error, not a state.
  CONSTRAINT programmes_dates_ordered
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

-- Plain CREATE INDEX (not CONCURRENTLY): the table is brand new and empty, so there is
-- nothing to block, and CONCURRENTLY cannot run inside a transaction block.
CREATE UNIQUE INDEX IF NOT EXISTS uq_programmes_code
  ON crm.programmes (tenant_id, programme_code);
CREATE INDEX IF NOT EXISTS idx_programmes_tenant_status
  ON crm.programmes (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_programmes_account
  ON crm.programmes (tenant_id, account_id);

ALTER TABLE crm.programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.programmes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'programmes_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'programmes'
  ) THEN
    CREATE POLICY programmes_tenant_isolation ON crm.programmes
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.programmes TO crm_svc;
  END IF;
END $g$;
