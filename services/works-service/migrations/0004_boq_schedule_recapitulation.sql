-- Purpose: Create BoQ items, schedule A, recapitulation, material coefficients
-- Rollback: DROP TABLE works.material_coefficients, works.recapitulation, works.schedule_a_items, works.boq_items;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.boq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  sr_item_id uuid,
  item_type varchar(64),
  item_description varchar(1024) NOT NULL,
  item_code varchar(64),
  unit varchar(64) NOT NULL,
  rate bigint NOT NULL,
  quantity numeric(18,4) NOT NULL,
  number_val numeric(12,4),
  length_val numeric(12,4),
  breadth_val numeric(12,4),
  depth_val numeric(12,4),
  scope_id uuid,
  remarks varchar(2048),
  amount_minor bigint NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.schedule_a_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  item_description varchar(1024) NOT NULL,
  unit varchar(64) NOT NULL,
  rate bigint NOT NULL,
  quantity numeric(18,4) NOT NULL,
  amount_minor bigint NOT NULL,
  remarks varchar(2048),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.recapitulation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  work_amount bigint NOT NULL,
  contingency_percent numeric(5,2) NOT NULL,
  turnover_tax_percent numeric(5,2) NOT NULL,
  work_charge_percent numeric(5,2) NOT NULL,
  quality_control_percent numeric(5,2) NOT NULL,
  centage_percent numeric(5,2) NOT NULL,
  other_charges bigint NOT NULL DEFAULT 0,
  grand_total bigint NOT NULL,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.material_coefficients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  boq_item_id uuid NOT NULL,
  material_name varchar(256) NOT NULL,
  coefficient numeric(12,6) NOT NULL,
  finalized boolean NOT NULL DEFAULT false,
  finalized_by uuid,
  finalized_at timestamptz,
  version int NOT NULL DEFAULT 1
);
