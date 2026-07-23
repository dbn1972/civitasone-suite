-- Purpose: Create Enforcement schema and tables (SVC-107)
-- Rollback: DROP TABLE IF EXISTS enforcement.prosecution_referrals;
--           DROP TABLE IF EXISTS enforcement.penalty_orders;
--           DROP TABLE IF EXISTS enforcement.show_cause_notices;
--           DROP TABLE IF EXISTS enforcement.penalty_rates;
--           DROP SCHEMA IF EXISTS enforcement;
-- Affected services: inspection-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS enforcement;

CREATE TABLE IF NOT EXISTS enforcement.penalty_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  provision_id    uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  amount          bigint NOT NULL,
  currency        varchar(3) NOT NULL DEFAULT 'INR',
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enforcement.show_cause_notices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  finding_id        uuid NOT NULL,
  entity_id         uuid NOT NULL,
  issued_to         text NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  response_deadline date NOT NULL,
  response_received boolean NOT NULL DEFAULT false,
  response_text     text,
  status            varchar(24) NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued', 'response_received', 'closed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enforcement.penalty_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  show_cause_id   uuid,
  finding_id      uuid NOT NULL,
  entity_id       uuid NOT NULL,
  penalty_rate_id uuid,
  amount          bigint NOT NULL,
  currency        varchar(3) NOT NULL DEFAULT 'INR',
  status          varchar(24) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'issued', 'paid', 'waived', 'appealed')),
  issued_by       uuid,
  issued_at       timestamptz,
  maker_user_id   uuid NOT NULL,
  checker_user_id uuid,
  finance_demand_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enforcement.prosecution_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  penalty_order_id uuid NOT NULL,
  finding_id      uuid NOT NULL,
  entity_id       uuid NOT NULL,
  legal_case_id   uuid,
  referred_by     uuid NOT NULL,
  referred_at     timestamptz NOT NULL DEFAULT now(),
  status          varchar(24) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'referred', 'accepted', 'rejected')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_rates_tenant
  ON enforcement.penalty_rates (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_show_cause_tenant
  ON enforcement.show_cause_notices (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_orders_tenant
  ON enforcement.penalty_orders (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_orders_status
  ON enforcement.penalty_orders (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_referrals_tenant
  ON enforcement.prosecution_referrals (tenant_id);
