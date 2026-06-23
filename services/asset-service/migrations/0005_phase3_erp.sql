-- Phase 3: Oracle/SAP parity — multi-book dep, AUC, leases, impairment, PM, workflow disposal

ALTER TABLE depreciation.asset_dep_schedules
  ADD COLUMN IF NOT EXISTS dep_book varchar(16) NOT NULL DEFAULT 'company';

ALTER TABLE depreciation.asset_dep_entries
  ADD COLUMN IF NOT EXISTS dep_book varchar(16) NOT NULL DEFAULT 'company';

ALTER TABLE register.asset_assets
  ADD COLUMN IF NOT EXISTS project_ref text,
  ADD COLUMN IF NOT EXISTS org_unit varchar(64),
  ADD COLUMN IF NOT EXISTS auc_id uuid;

CREATE INDEX IF NOT EXISTS idx_dep_schedules_book ON depreciation.asset_dep_schedules(tenant_id, dep_book);
CREATE INDEX IF NOT EXISTS idx_dep_entries_book ON depreciation.asset_dep_entries(tenant_id, dep_book, period);

CREATE SCHEMA IF NOT EXISTS enterprise;

CREATE TABLE IF NOT EXISTS enterprise.project_auc (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  project_code     text NOT NULL,
  name             text NOT NULL,
  wbs_ref          text,
  accumulated_minor bigint NOT NULL DEFAULT 0,
  currency         char(3) NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'under_construction',
  asset_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, project_code)
);

CREATE TABLE IF NOT EXISTS enterprise.asset_leases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  lease_no          text NOT NULL,
  lessor_name       text NOT NULL,
  rou_cost_minor    bigint NOT NULL DEFAULT 0,
  liability_minor   bigint NOT NULL DEFAULT 0,
  lease_start       date NOT NULL,
  lease_end         date NOT NULL,
  asset_id          uuid,
  status            varchar(24) NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, lease_no)
);

CREATE TABLE IF NOT EXISTS enterprise.asset_impairments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  asset_id         uuid NOT NULL,
  event_type       varchar(16) NOT NULL CHECK (event_type IN ('impairment', 'revaluation')),
  amount_minor     bigint NOT NULL,
  book_value_before bigint NOT NULL,
  book_value_after bigint NOT NULL,
  reason           text,
  event_date       date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS enterprise.functional_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  parent_id   uuid,
  org_unit    varchar(64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS enterprise.spare_parts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  work_order_id   uuid NOT NULL,
  part_code       text NOT NULL,
  description     text,
  qty             integer NOT NULL DEFAULT 1,
  cost_minor      bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS lifecycle.pending_disposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  asset_id         uuid NOT NULL,
  disposal_date    date NOT NULL,
  disposal_method  varchar(32) NOT NULL,
  proceeds_minor   bigint NOT NULL DEFAULT 0,
  currency         char(3) NOT NULL DEFAULT 'INR',
  notes            text,
  workflow_status  varchar(24) NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS lifecycle.inter_org_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  asset_id      uuid NOT NULL,
  from_org      varchar(64) NOT NULL,
  to_org        varchar(64) NOT NULL,
  transfer_date date NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);
