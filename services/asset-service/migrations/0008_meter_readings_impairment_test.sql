-- 0008: Meter/condition-based maintenance + IND-AS 36 impairment testing
-- Addresses Maximo parity gaps: meter readings, threshold-triggered PM, structured impairment

-- ── Meter readings (odometer, hours-run, cycle-count, etc.) ──────────────────
CREATE TABLE IF NOT EXISTS maintenance.asset_meter_readings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  asset_id       uuid NOT NULL,
  meter_type     varchar(32) NOT NULL CHECK (meter_type IN ('odometer', 'hours_run', 'cycles', 'temperature', 'vibration', 'custom')),
  reading_value  numeric(18, 4) NOT NULL,
  unit           varchar(16) NOT NULL DEFAULT 'km',
  reading_date   date NOT NULL,
  source         varchar(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'iot', 'mobile')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meter_readings_asset
  ON maintenance.asset_meter_readings(tenant_id, asset_id, meter_type, reading_date DESC);

-- ── Meter thresholds on maintenance plans (trigger work orders) ──────────────
ALTER TABLE maintenance.asset_maintenance_plans
  ADD COLUMN IF NOT EXISTS trigger_type varchar(16) NOT NULL DEFAULT 'calendar'
    CHECK (trigger_type IN ('calendar', 'meter', 'condition', 'both')),
  ADD COLUMN IF NOT EXISTS meter_type varchar(32),
  ADD COLUMN IF NOT EXISTS meter_threshold numeric(18, 4),
  ADD COLUMN IF NOT EXISTS last_meter_value numeric(18, 4);

COMMENT ON COLUMN maintenance.asset_maintenance_plans.trigger_type IS
  'calendar = time-based (frequency+nextDue), meter = threshold-based, condition = sensor-based, both = whichever comes first';

-- ── IND-AS 36 impairment tests (structured assessment) ───────────────────────
CREATE TABLE IF NOT EXISTS enterprise.impairment_tests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  asset_id                uuid NOT NULL,
  test_date               date NOT NULL,
  -- Carrying amount at test date
  carrying_amount_minor   bigint NOT NULL,
  -- Fair value less costs of disposal (IND-AS 36 para 25-29)
  fair_value_minor        bigint,
  disposal_costs_minor    bigint NOT NULL DEFAULT 0,
  -- Value in use via DCF (IND-AS 36 para 30-57)
  value_in_use_minor      bigint,
  discount_rate_bps       integer, -- basis points (e.g. 1200 = 12%)
  projection_years        integer,
  -- Computed fields
  recoverable_amount_minor bigint NOT NULL,
  impairment_loss_minor   bigint NOT NULL DEFAULT 0,
  -- CGU (Cash Generating Unit) grouping
  cgu_id                  uuid,
  cgu_name                text,
  -- Outcome
  outcome                 varchar(16) NOT NULL DEFAULT 'no_impairment'
    CHECK (outcome IN ('no_impairment', 'impairment_recognised', 'reversal')),
  -- Link to the posted impairment event (if outcome = impairment_recognised)
  impairment_event_id     uuid,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_impairment_tests_asset
  ON enterprise.impairment_tests(tenant_id, asset_id, test_date DESC);

-- ── CGU (Cash Generating Unit) registry ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS enterprise.cash_generating_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  UNIQUE (tenant_id, code)
);
