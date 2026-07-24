-- Migration: 0001_rate_engine_schema.sql
-- Purpose: Create the `rates` schema with rate_heads, rate_slabs, penalty_rules, rebate_rules tables.
-- Rollback: DROP SCHEMA rates CASCADE; (destructive — requires approval)
-- Requirements: SVC-136

SET lock_timeout = '5s';

-- ── Schema ────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS rates;

-- ── Helper function (idempotent) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS
  $$ SELECT current_setting('app.tenant_id', true)::uuid $$;

-- ── rates.rate_heads ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.rate_heads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  code             varchar(64) NOT NULL,
  name             text NOT NULL,
  category         varchar(64) NOT NULL,
  unit_of_measure  varchar(32),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_rate_heads_tenant_code UNIQUE (tenant_id, code)
);

ALTER TABLE rates.rate_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rate_heads FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rate_heads' AND schemaname = 'rates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON rates.rate_heads
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rate_heads_tenant_category ON rates.rate_heads (tenant_id, category);

-- ── rates.rate_slabs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.rate_slabs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  rate_head_id     uuid NOT NULL REFERENCES rates.rate_heads(id),
  slab_type        varchar(16) NOT NULL CHECK (slab_type IN ('flat', 'band', 'ad_valorem')),
  band_from        bigint,
  band_to          bigint,
  rate_value       bigint NOT NULL,
  effective_from   date NOT NULL,
  effective_to     date,
  unit_of_measure  varchar(32),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

ALTER TABLE rates.rate_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rate_slabs FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rate_slabs' AND schemaname = 'rates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON rates.rate_slabs
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rate_slabs_tenant_head ON rates.rate_slabs (tenant_id, rate_head_id);
CREATE INDEX IF NOT EXISTS idx_rate_slabs_effective ON rates.rate_slabs (rate_head_id, effective_from, effective_to);

-- ── rates.penalty_rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.penalty_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  rate_head_id     uuid NOT NULL REFERENCES rates.rate_heads(id),
  interest_type    varchar(16) NOT NULL CHECK (interest_type IN ('simple', 'compound')),
  annual_rate_bps  integer NOT NULL,
  grace_days       integer NOT NULL DEFAULT 0,
  cap_months       integer,
  rounding_mode    varchar(16) NOT NULL DEFAULT 'round_half_up'
                   CHECK (rounding_mode IN ('round_half_up', 'floor', 'ceil')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

ALTER TABLE rates.penalty_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.penalty_rules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'penalty_rules' AND schemaname = 'rates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON rates.penalty_rules
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_penalty_rules_tenant_head ON rates.penalty_rules (tenant_id, rate_head_id);

-- ── rates.rebate_rules ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.rebate_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  rate_head_id     uuid NOT NULL REFERENCES rates.rate_heads(id),
  rebate_type      varchar(24) NOT NULL CHECK (rebate_type IN ('early_payment', 'category')),
  discount_bps     integer NOT NULL,
  valid_until_days_before_due integer,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

ALTER TABLE rates.rebate_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rebate_rules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rebate_rules' AND schemaname = 'rates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON rates.rebate_rules
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rebate_rules_tenant_head ON rates.rebate_rules (tenant_id, rate_head_id);
