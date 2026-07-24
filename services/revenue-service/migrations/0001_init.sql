-- revenue-service: initial schema creation
-- Purpose: Create all PG schemas and core tables for municipal revenue
-- Rollback: DROP SCHEMA rates, assessee, assessment, billing, collection, arrears, bbps CASCADE;
-- Affected services: revenue-service

SET lock_timeout = '5s';

-- ── PG Schemas ────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS rates;
CREATE SCHEMA IF NOT EXISTS assessee;
CREATE SCHEMA IF NOT EXISTS assessment;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS collection;
CREATE SCHEMA IF NOT EXISTS arrears;
CREATE SCHEMA IF NOT EXISTS bbps;
CREATE SCHEMA IF NOT EXISTS _outbox;

-- ── rates.rate_heads ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.rate_heads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  code            varchar(64) NOT NULL,
  name            text NOT NULL,
  category        varchar(64) NOT NULL,
  unit_of_measure varchar(32),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── rates.rate_slabs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.rate_slabs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  rate_head_id    uuid NOT NULL,
  slab_type       varchar(16) NOT NULL,
  band_from       bigint,
  band_to         bigint,
  rate_value      bigint NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,
  unit_of_measure varchar(32),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── rates.penalty_rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.penalty_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  rate_head_id    uuid NOT NULL,
  interest_type   varchar(16) NOT NULL,
  annual_rate_bps integer NOT NULL,
  grace_days      integer NOT NULL DEFAULT 0,
  cap_months      integer,
  rounding_mode   varchar(16) NOT NULL DEFAULT 'round_half_up',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── rates.rebate_rules ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates.rebate_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  rate_head_id    uuid NOT NULL,
  rebate_type     varchar(24) NOT NULL,
  discount_bps    integer NOT NULL,
  valid_until_days_before_due integer,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── assessee.assessees ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessee.assessees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_type   varchar(32) NOT NULL,
  identifier_no   varchar(64) NOT NULL,
  owner_name      text NOT NULL,
  address         text NOT NULL,
  ward_no         varchar(16),
  zone_no         varchar(16),
  connection_size varchar(16),
  property_type   varchar(32),
  built_up_area   bigint,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── assessment.assessments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessment.assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  rate_head_id    uuid NOT NULL,
  financial_year  varchar(9) NOT NULL,
  base_value      bigint NOT NULL,
  exemptions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          varchar(24) NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── assessment.demands ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessment.demands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  assessment_id   uuid NOT NULL,
  rate_head_id    uuid NOT NULL,
  financial_year  varchar(9) NOT NULL,
  due_date        date NOT NULL,
  principal_minor bigint NOT NULL,
  rebate_minor    bigint NOT NULL DEFAULT 0,
  penalty_minor   bigint NOT NULL DEFAULT 0,
  interest_minor  bigint NOT NULL DEFAULT 0,
  net_minor       bigint NOT NULL,
  compute_snapshot jsonb NOT NULL,
  status          varchar(24) NOT NULL DEFAULT 'raised',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── assessment.dcb_entries ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessment.dcb_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  demand_id       uuid NOT NULL,
  entry_type      varchar(16) NOT NULL,
  amount_minor    bigint NOT NULL,
  balance_minor   bigint NOT NULL,
  reference_id    uuid,
  reference_type  varchar(24),
  narration       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL
);

-- ── assessment.remissions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessment.remissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessment_id   uuid NOT NULL,
  reason          text NOT NULL,
  remission_percent integer,
  amount_minor    bigint,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  maker_user_id   uuid NOT NULL,
  checker_user_id uuid,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

-- ── billing.bills ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing.bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  demand_id       uuid NOT NULL,
  assessment_id   uuid NOT NULL,
  bill_no         varchar(32) NOT NULL,
  bill_date       date NOT NULL,
  due_date        date NOT NULL,
  principal_minor bigint NOT NULL,
  rebate_minor    bigint NOT NULL DEFAULT 0,
  penalty_minor   bigint NOT NULL DEFAULT 0,
  total_minor     bigint NOT NULL,
  receipt_head_code varchar(32) NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'issued',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── collection.receipts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collection.receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  demand_id       uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  channel         varchar(16) NOT NULL,
  reference       text,
  instrument_no   varchar(64),
  bank_name       varchar(128),
  receipt_no      varchar(32),
  status          varchar(16) NOT NULL DEFAULT 'captured',
  reconciled      boolean NOT NULL DEFAULT false,
  reconciled_at   timestamptz,
  recon_line_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── collection.refunds ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collection.refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  receipt_id      uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  reason          text NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  maker_user_id   uuid NOT NULL,
  checker_user_id uuid,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

-- ── collection.adjustments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collection.adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  from_demand_id  uuid NOT NULL,
  to_demand_id    uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── arrears.instalment_plans ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arrears.instalment_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  total_minor     bigint NOT NULL,
  instalment_count integer NOT NULL,
  start_date      date NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── arrears.instalments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arrears.instalments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  plan_id         uuid NOT NULL,
  sequence_no     integer NOT NULL,
  due_date        date NOT NULL,
  amount_minor    bigint NOT NULL,
  paid_minor      bigint NOT NULL DEFAULT 0,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── arrears.write_offs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arrears.write_offs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  reason          text NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  maker_user_id   uuid NOT NULL,
  checker_user_id uuid,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

-- ── arrears.recovery_referrals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arrears.recovery_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  assessee_id     uuid NOT NULL,
  reason          text NOT NULL,
  legal_case_id   uuid,
  status          varchar(16) NOT NULL DEFAULT 'referred',
  referred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

-- ── bbps.biller_config ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bbps.biller_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  biller_code     varchar(32) NOT NULL,
  biller_name     text NOT NULL,
  biller_category varchar(32) NOT NULL,
  api_endpoint    text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

-- ── bbps.bbps_transactions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bbps.bbps_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  bbps_txn_id     varchar(64) NOT NULL,
  assessee_id     uuid,
  amount_minor    bigint NOT NULL,
  channel         varchar(16) NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  receipt_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

-- ── _outbox.messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  topic           text NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  actor_id        uuid NOT NULL,
  correlation_id  text,
  published       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── _outbox.inbox (idempotency) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _outbox.inbox (
  message_id      uuid PRIMARY KEY,
  processed_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common access patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_slabs_head_active ON rates.rate_slabs(rate_head_id, is_active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_demands_assessee ON assessment.demands(assessee_id, tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcb_assessee_demand ON assessment.dcb_entries(assessee_id, demand_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_demand ON collection.receipts(demand_id, tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(published, created_at) WHERE published = false;
