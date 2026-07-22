-- Purpose: Create billing tables (measurement books, measurements, bills, bill items, recoveries, account compilations)
-- Rollback: DROP TABLE works.account_compilations, works.bill_recoveries, works.bill_items, works.bills, works.measurements, works.measurement_books;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.measurement_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  award_id uuid NOT NULL,
  mb_number varchar(64) NOT NULL,
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  status varchar(32) NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  mb_id uuid NOT NULL,
  boq_item_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL,
  number_val numeric(12,4),
  length_val numeric(12,4),
  breadth_val numeric(12,4),
  depth_val numeric(12,4),
  remarks varchar(2048),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  award_id uuid NOT NULL,
  mb_id uuid,
  bill_mode varchar(16) NOT NULL,
  bill_number varchar(64) NOT NULL,
  gross_amount_minor bigint NOT NULL,
  deductions_minor bigint NOT NULL DEFAULT 0,
  net_payable_minor bigint NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  ifms_ref varchar(128),
  submitted_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  boq_item_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL,
  rate bigint NOT NULL,
  amount_minor bigint NOT NULL,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.bill_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  recovery_type varchar(64) NOT NULL,
  amount_minor bigint NOT NULL,
  remarks varchar(2048),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.account_compilations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  month int NOT NULL,
  year int NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  submitted_to varchar(256),
  submitted_at timestamptz,
  dag_ref varchar(128),
  version int NOT NULL DEFAULT 1
);
