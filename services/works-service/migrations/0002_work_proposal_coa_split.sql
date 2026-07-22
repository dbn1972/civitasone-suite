-- Purpose: Create work proposal, COA mapping, split, and office mapping tables
-- Rollback: DROP TABLE works.work_office_mappings, works.work_splits, works.work_coa_mappings, works.work_proposals;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.work_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_number varchar(64) NOT NULL,
  category varchar(32) NOT NULL,
  description varchar(2048) NOT NULL,
  work_type_id uuid NOT NULL,
  work_sub_type_id uuid,
  estimated_cost_minor bigint NOT NULL,
  executing_division_id uuid,
  executing_sub_division_id uuid,
  executing_section_id uuid,
  district varchar(128),
  taluka varchar(128),
  village varchar(128),
  habitation varchar(128),
  mla_constituency varchar(128),
  proposer_type_id uuid,
  source_department_id uuid,
  scheme_id uuid,
  charged_or_voted varchar(16),
  tribal_or_non_tribal varchar(16),
  backlog_or_non_backlog varchar(16),
  plan_or_non_plan varchar(16),
  demand_number varchar(64),
  sector varchar(128),
  budget_month int,
  budget_year int,
  program_id uuid,
  repair_type_id uuid,
  asset_id uuid,
  kml_file_key varchar(512),
  chainage varchar(64),
  remarks varchar(2048),
  new_or_upgrade varchar(16),
  status varchar(32) NOT NULL DEFAULT 'draft',
  dao_finalized_by uuid,
  dao_finalized_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.work_coa_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  major_head varchar(16) NOT NULL,
  sub_major_head varchar(16),
  minor_head varchar(16),
  sub_head varchar(16),
  detail_head varchar(16),
  object_head varchar(16),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parent_work_id uuid NOT NULL,
  split_number varchar(64) NOT NULL,
  description varchar(2048),
  status varchar(16) NOT NULL DEFAULT 'active',
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.work_office_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  split_id uuid,
  division_id uuid NOT NULL,
  sub_division_id uuid,
  section_id uuid,
  is_nodal boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1
);
