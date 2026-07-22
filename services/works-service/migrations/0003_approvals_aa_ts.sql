-- Purpose: Create administrative approval and technical sanction tables
-- Rollback: DROP TABLE works.technical_sanctions, works.administrative_approvals;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.administrative_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  aa_number varchar(64) NOT NULL,
  aa_date timestamptz NOT NULL,
  approving_authority_id uuid NOT NULL,
  approving_office_id uuid,
  approved_amount_minor bigint NOT NULL,
  remarks varchar(2048),
  approval_type varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  finalized_by uuid,
  finalized_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.technical_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  ts_number varchar(64) NOT NULL,
  ts_date timestamptz NOT NULL,
  ts_office_id uuid,
  ts_authority_id uuid NOT NULL,
  sr_year varchar(16),
  zone varchar(64),
  ts_amount_minor bigint NOT NULL,
  remarks varchar(2048),
  sanction_type varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  finalized_by uuid,
  finalized_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
