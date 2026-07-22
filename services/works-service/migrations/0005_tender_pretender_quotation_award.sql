-- Purpose: Create pre-tender, tender, quotation, quotation items, and award tables
-- Rollback: DROP TABLE works.awards, works.quotation_items, works.quotations, works.tenders, works.pre_tenders;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.pre_tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  reference_number varchar(128),
  tender_type varchar(64),
  covers int,
  tender_category varchar(64),
  product_category varchar(64),
  bid_openers int,
  contract_form varchar(64),
  bid_validity int,
  tender_class varchar(64),
  fees bigint,
  publication_date timestamptz,
  download_date timestamptz,
  clarification_date timestamptz,
  bid_submission_date timestamptz,
  opening_date timestamptz,
  status varchar(32) NOT NULL DEFAULT 'draft',
  transferred_to varchar(256),
  gepnic_ref varchar(128),
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  tender_type_id uuid,
  tender_amount_minor bigint NOT NULL,
  opening_date timestamptz,
  approving_authority_id uuid,
  contractor_class_id uuid,
  remarks varchar(2048),
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tender_id uuid NOT NULL,
  contractor_name varchar(256) NOT NULL,
  method varchar(32) NOT NULL,
  quoted_amount_minor bigint,
  quoted_percentage varchar(16),
  above_or_below_or_at_par varchar(16),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  quotation_id uuid NOT NULL,
  boq_item_id uuid NOT NULL,
  contractor_rate bigint NOT NULL,
  comparison varchar(64),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  contractor_name varchar(256) NOT NULL,
  agreement_number varchar(128),
  work_order_number varchar(128),
  agreement_date timestamptz,
  authority_id uuid,
  actual_commencement timestamptz,
  work_period_days int,
  stipulated_completion timestamptz,
  agreement_type varchar(64),
  bill_mode varchar(16),
  accepted_amount_minor bigint NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  dao_finalized_by uuid,
  dao_finalized_at timestamptz,
  do_finalized_by uuid,
  do_finalized_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
