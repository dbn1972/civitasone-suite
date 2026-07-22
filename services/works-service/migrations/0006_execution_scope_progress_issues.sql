-- Purpose: Create execution tables (scopes, progress, photos, issues, targets, completions, closures)
-- Rollback: DROP TABLE works.work_closures, works.physical_completions, works.financial_targets, works.issue_observations, works.work_issues, works.work_photos, works.physical_targets, works.scope_progress, works.work_scopes;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.work_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  target_value numeric(18,4),
  description varchar(2048),
  planned_start timestamptz,
  planned_end timestamptz,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.scope_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_scope_id uuid NOT NULL,
  month int NOT NULL,
  year int NOT NULL,
  prior_achievement numeric(18,4),
  current_achievement numeric(18,4),
  percentage numeric(5,2),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  user_id uuid NOT NULL,
  file_key varchar(512) NOT NULL,
  description varchar(2048),
  capture_date timestamptz,
  latitude numeric(10,7),
  longitude numeric(10,7),
  source varchar(16),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  issue_type_id uuid,
  forwarded_to uuid,
  raised_date timestamptz NOT NULL,
  description varchar(2048) NOT NULL,
  attachment_key varchar(512),
  status varchar(16) NOT NULL DEFAULT 'open',
  closed_date timestamptz,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.issue_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  observation varchar(2048) NOT NULL,
  attachment_key varchar(512),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS works.physical_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  boq_item_id uuid,
  financial_year varchar(16) NOT NULL,
  apr numeric(18,4), may numeric(18,4), jun numeric(18,4),
  jul numeric(18,4), aug numeric(18,4), sep numeric(18,4),
  oct numeric(18,4), nov numeric(18,4), dec_ numeric(18,4),
  jan numeric(18,4), feb numeric(18,4), mar numeric(18,4),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.financial_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  budget_year varchar(16) NOT NULL,
  month int NOT NULL,
  cumulative_target bigint NOT NULL,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.physical_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  completion_date timestamptz NOT NULL,
  certificate_file_key varchar(512),
  completed_by uuid NOT NULL,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_id uuid NOT NULL,
  closure_type varchar(16) NOT NULL,
  closed_date timestamptz NOT NULL,
  remarks varchar(2048),
  version int NOT NULL DEFAULT 1
);
