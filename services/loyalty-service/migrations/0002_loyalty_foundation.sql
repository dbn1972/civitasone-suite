-- 0002_loyalty_foundation.sql
-- Purpose: Create programs, enrolments, accruals, tier_definitions, tier_assignments tables.
-- Affected services: loyalty-service
--
-- Rollback:
--   DROP TABLE IF EXISTS loyalty.tier_assignments;
--   DROP TABLE IF EXISTS loyalty.tier_definitions;
--   DROP TABLE IF EXISTS loyalty.accruals;
--   DROP TABLE IF EXISTS loyalty.enrolments;
--   DROP TABLE IF EXISTS loyalty.programs;

SET lock_timeout = '5s';

-- ── Schema (idempotent) ────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS loyalty;

-- ── Programs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty.programs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  name           varchar(200) NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'draft',
  earn_ratio     bigint NOT NULL DEFAULT 100,
  expiry_days    integer,
  tier_config    jsonb NOT NULL DEFAULT '{}',
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  CONSTRAINT loyalty_programs_status_check CHECK (status IN ('draft','active','suspended','archived')),
  CONSTRAINT loyalty_programs_earn_ratio_positive CHECK (earn_ratio > 0)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_programs_tenant_idx
  ON loyalty.programs (tenant_id);

ALTER TABLE loyalty.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.programs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_programs_tenant_isolation ON loyalty.programs;
CREATE POLICY loyalty_programs_tenant_isolation ON loyalty.programs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty.programs TO loyalty_svc;

-- ── Enrolments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty.enrolments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  program_id     uuid NOT NULL REFERENCES loyalty.programs(id),
  profile_id     uuid NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'active',
  tier           varchar(50) NOT NULL DEFAULT 'base',
  points_balance bigint NOT NULL DEFAULT 0,
  lifetime_points bigint NOT NULL DEFAULT 0,
  enrolled_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT loyalty_enrolments_status_check CHECK (status IN ('active','suspended','cancelled')),
  CONSTRAINT loyalty_enrolments_balance_non_negative CHECK (points_balance >= 0),
  CONSTRAINT loyalty_enrolments_unique_member UNIQUE (tenant_id, program_id, profile_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_enrolments_tenant_program_idx
  ON loyalty.enrolments (tenant_id, program_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_enrolments_tenant_profile_idx
  ON loyalty.enrolments (tenant_id, profile_id);

ALTER TABLE loyalty.enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.enrolments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_enrolments_tenant_isolation ON loyalty.enrolments;
CREATE POLICY loyalty_enrolments_tenant_isolation ON loyalty.enrolments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty.enrolments TO loyalty_svc;

-- ── Accruals ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty.accruals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  enrolment_id   uuid NOT NULL REFERENCES loyalty.enrolments(id),
  points         bigint NOT NULL,
  source         varchar(100) NOT NULL,
  source_ref     varchar(200),
  tx_type        varchar(50) NOT NULL DEFAULT 'purchase',
  expires_at     timestamptz,
  accrual_date   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  CONSTRAINT loyalty_accruals_points_positive CHECK (points > 0),
  CONSTRAINT loyalty_accruals_tx_type_check CHECK (tx_type IN ('purchase','bonus','referral','promotion','adjustment'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_accruals_enrolment_idx
  ON loyalty.accruals (enrolment_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_accruals_tenant_date_idx
  ON loyalty.accruals (tenant_id, accrual_date DESC);

ALTER TABLE loyalty.accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.accruals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_accruals_tenant_isolation ON loyalty.accruals;
CREATE POLICY loyalty_accruals_tenant_isolation ON loyalty.accruals
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty.accruals TO loyalty_svc;

-- ── Tier Definitions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty.tier_definitions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  program_id            uuid NOT NULL REFERENCES loyalty.programs(id),
  name                  varchar(100) NOT NULL,
  level                 integer NOT NULL,
  min_points_threshold  bigint NOT NULL DEFAULT 0,
  benefits              jsonb NOT NULL DEFAULT '{}',
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_tier_definitions_level_positive CHECK (level >= 0),
  CONSTRAINT loyalty_tier_definitions_threshold_non_negative CHECK (min_points_threshold >= 0)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_tier_defs_program_idx
  ON loyalty.tier_definitions (tenant_id, program_id);

ALTER TABLE loyalty.tier_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.tier_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_tier_definitions_tenant_isolation ON loyalty.tier_definitions;
CREATE POLICY loyalty_tier_definitions_tenant_isolation ON loyalty.tier_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty.tier_definitions TO loyalty_svc;

-- ── Tier Assignments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty.tier_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  enrolment_id         uuid NOT NULL REFERENCES loyalty.enrolments(id),
  tier_definition_id   uuid NOT NULL REFERENCES loyalty.tier_definitions(id),
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_tier_assignments_enrolment_idx
  ON loyalty.tier_assignments (tenant_id, enrolment_id);

ALTER TABLE loyalty.tier_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.tier_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_tier_assignments_tenant_isolation ON loyalty.tier_assignments;
CREATE POLICY loyalty_tier_assignments_tenant_isolation ON loyalty.tier_assignments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty.tier_assignments TO loyalty_svc;

-- ── Update redemptions to reference enrolment ──────────────────────────────
-- Add enrolment_id to redemptions (nullable for backward compat)
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS enrolment_id uuid;
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS void_reason varchar(500);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_redemptions_enrolment_idx
  ON loyalty.redemptions (enrolment_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS loyalty_redemptions_redeemed_at_idx
  ON loyalty.redemptions (tenant_id, redeemed_at DESC);
