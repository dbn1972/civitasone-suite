-- project-service initial migration
-- Run as: project_svc on civitas_project
-- Prefix: project_
-- L2 schemas: project, scheme, progress, utilisation, geo

CREATE SCHEMA IF NOT EXISTS project;
CREATE SCHEMA IF NOT EXISTS scheme;
CREATE SCHEMA IF NOT EXISTS progress;
CREATE SCHEMA IF NOT EXISTS utilisation;
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ── _outbox / _inbox ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ── project module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project.project_projects (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL,
  code               text         NOT NULL,
  name               text         NOT NULL,
  scheme_id          uuid,
  agency_ref         text,                      -- opaque "finance_vendors:UUID"
  dpr_cost_minor     bigint       NOT NULL DEFAULT 0,
  sanctioned_minor   bigint       NOT NULL DEFAULT 0,
  sanction_ref       text,                      -- opaque "finance_sanction:UUID"
  currency           char(3)      NOT NULL DEFAULT 'INR',
  status             varchar(24)  NOT NULL DEFAULT 'planned'
                       CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
  start_date         date,
  end_date           date,
  physical_pct       numeric(5,2) NOT NULL DEFAULT 0,
  financial_pct      numeric(5,2) NOT NULL DEFAULT 0,
  rag                varchar(16)  NOT NULL DEFAULT 'green',
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  created_by         uuid         NOT NULL,
  updated_by         uuid         NOT NULL,
  version            integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_status
  ON project.project_projects (tenant_id, status);

CREATE TABLE IF NOT EXISTS project.project_tasks (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid         NOT NULL REFERENCES project.project_projects(id),
  tenant_id        uuid         NOT NULL,
  parent_task_id   uuid,                        -- self-referencing for sub-tasks
  name             text         NOT NULL,
  description      text,
  weight_pct       numeric(5,2) NOT NULL DEFAULT 0,
  status           varchar(24)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','in_progress','completed','blocked')),
  planned_start    date,
  planned_end      date,
  actual_start     date,
  actual_end       date,
  progress_pct     numeric(5,2) NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1
);

ALTER TABLE project.project_tasks
  ADD CONSTRAINT fk_task_parent FOREIGN KEY (parent_task_id)
    REFERENCES project.project_tasks(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_tasks_project ON project.project_tasks (project_id);

CREATE TABLE IF NOT EXISTS project.project_milestones (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid         NOT NULL REFERENCES project.project_projects(id),
  tenant_id        uuid         NOT NULL,
  name             text         NOT NULL,
  planned_date     date         NOT NULL,
  actual_date      date,
  payment_minor    bigint       NOT NULL DEFAULT 0,
  currency         char(3)      NOT NULL DEFAULT 'INR',
  status           varchar(24)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','completed','cancelled')),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON project.project_milestones (project_id);

CREATE TABLE IF NOT EXISTS project.project_members (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid         NOT NULL REFERENCES project.project_projects(id),
  tenant_id        uuid         NOT NULL,
  user_id          uuid         NOT NULL,
  role             varchar(64)  NOT NULL DEFAULT 'member',
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1,
  UNIQUE (project_id, user_id)
);

-- ── scheme module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scheme.project_schemes (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid         NOT NULL,
  code                text         NOT NULL,
  name                text         NOT NULL,
  type                varchar(24)  NOT NULL DEFAULT 'css'
                        CHECK (type IN ('css','state','central')),
  funding_pattern     text         NOT NULL DEFAULT '100',   -- "60:40", "50:50" etc.
  total_outlay_minor  bigint       NOT NULL DEFAULT 0,
  released_minor      bigint       NOT NULL DEFAULT 0,
  utilised_minor      bigint       NOT NULL DEFAULT 0,
  sanction_ref        text,                                  -- opaque "finance_sanction:UUID"
  status              varchar(24)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','completed','cancelled')),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_by          uuid         NOT NULL,
  updated_by          uuid         NOT NULL,
  version             integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS scheme.project_scheme_components (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id         uuid         NOT NULL REFERENCES scheme.project_schemes(id),
  tenant_id         uuid         NOT NULL,
  code              text         NOT NULL,
  name              text         NOT NULL,
  allocation_minor  bigint       NOT NULL DEFAULT 0,
  released_minor    bigint       NOT NULL DEFAULT 0,
  utilised_minor    bigint       NOT NULL DEFAULT 0,
  currency          char(3)      NOT NULL DEFAULT 'INR',
  weight_pct        numeric(5,2) NOT NULL DEFAULT 0,
  physical_pct      numeric(5,2) NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  created_by        uuid         NOT NULL,
  updated_by        uuid         NOT NULL,
  version           integer      NOT NULL DEFAULT 1,
  UNIQUE (scheme_id, code)
);

CREATE INDEX IF NOT EXISTS idx_scheme_components_scheme
  ON scheme.project_scheme_components (scheme_id);

CREATE TABLE IF NOT EXISTS scheme.project_fund_releases (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id        uuid         NOT NULL REFERENCES scheme.project_schemes(id),
  component_id     uuid         NOT NULL REFERENCES scheme.project_scheme_components(id),
  tenant_id        uuid         NOT NULL,
  release_no       text         NOT NULL,
  amount_minor     bigint       NOT NULL DEFAULT 0,
  currency         char(3)      NOT NULL DEFAULT 'INR',
  status           varchar(24)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','disbursed','returned')),
  to_entity        varchar(32)  NOT NULL DEFAULT 'agency',   -- "state" | "agency"
  pfms_ref         text,                                     -- PFMS integration reference
  sanctioned_by    uuid,
  sanctioned_at    timestamptz,
  disbursed_at     timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, release_no)
);

CREATE INDEX IF NOT EXISTS idx_fund_releases_scheme
  ON scheme.project_fund_releases (scheme_id, status);

-- ── progress module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS progress.project_physical_progress (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid         NOT NULL,
  component_id     uuid,
  tenant_id        uuid         NOT NULL,
  period_date      date         NOT NULL,
  physical_pct     numeric(5,2) NOT NULL DEFAULT 0
                     CHECK (physical_pct >= 0 AND physical_pct <= 100),
  cumulative_pct   numeric(5,2) NOT NULL DEFAULT 0,
  reported_by      uuid         NOT NULL,
  notes            text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_physical_progress_project
  ON progress.project_physical_progress (project_id, period_date);

CREATE TABLE IF NOT EXISTS progress.project_financial_progress (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid         NOT NULL,
  tenant_id           uuid         NOT NULL,
  period_date         date         NOT NULL,
  expenditure_minor   bigint       NOT NULL DEFAULT 0,
  cumulative_minor    bigint       NOT NULL DEFAULT 0,
  currency            char(3)      NOT NULL DEFAULT 'INR',
  reported_by         uuid         NOT NULL,
  notes               text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_by          uuid         NOT NULL,
  updated_by          uuid         NOT NULL,
  version             integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_financial_progress_project
  ON progress.project_financial_progress (project_id, period_date);

CREATE TABLE IF NOT EXISTS progress.project_dprs (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid         NOT NULL,
  tenant_id        uuid         NOT NULL,
  dpr_no           text         NOT NULL,
  dpr_date         date         NOT NULL,
  status           varchar(24)  NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted','under_review','approved','revision')),
  content          jsonb        NOT NULL DEFAULT '{}',
  submitted_by     uuid         NOT NULL,
  submitted_at     timestamptz  NOT NULL DEFAULT now(),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1,
  UNIQUE (project_id, dpr_date)   -- immutable: one DPR per project per date
);

CREATE INDEX IF NOT EXISTS idx_dprs_project ON progress.project_dprs (project_id);

-- ── utilisation module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS utilisation.project_uc_statements (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id           uuid         NOT NULL,
  tenant_id           uuid         NOT NULL,
  uc_no               text         NOT NULL,
  period_from         date         NOT NULL,
  period_to           date         NOT NULL,
  released_minor      bigint       NOT NULL DEFAULT 0,
  expenditure_minor   bigint       NOT NULL DEFAULT 0
                        CHECK (expenditure_minor >= 0),
  balance_minor       bigint       NOT NULL DEFAULT 0,
  status              varchar(24)  NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','verified','certified')),
  submitted_by        uuid         NOT NULL,
  submitted_at        timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_by          uuid         NOT NULL,
  updated_by          uuid         NOT NULL,
  version             integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, uc_no)
);

CREATE INDEX IF NOT EXISTS idx_uc_statements_scheme
  ON utilisation.project_uc_statements (scheme_id);

CREATE TABLE IF NOT EXISTS utilisation.project_uc_items (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  uc_statement_id     uuid         NOT NULL
                        REFERENCES utilisation.project_uc_statements(id),
  component_id        uuid         NOT NULL,
  tenant_id           uuid         NOT NULL,
  released_minor      bigint       NOT NULL DEFAULT 0,
  expenditure_minor   bigint       NOT NULL DEFAULT 0,
  currency            char(3)      NOT NULL DEFAULT 'INR',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_by          uuid         NOT NULL,
  updated_by          uuid         NOT NULL,
  version             integer      NOT NULL DEFAULT 1
);

-- ── geo module ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS geo.project_geo_tags (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid           NOT NULL,
  tenant_id        uuid           NOT NULL,
  lat              numeric(10,7)  NOT NULL,
  lon              numeric(10,7)  NOT NULL,
  location_name    text,
  description      text,
  tagged_by        uuid           NOT NULL,
  tagged_at        timestamptz    NOT NULL DEFAULT now(),
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  created_by       uuid           NOT NULL,
  updated_by       uuid           NOT NULL,
  version          integer        NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_geo_tags_project ON geo.project_geo_tags (project_id);

CREATE TABLE IF NOT EXISTS geo.project_site_photos (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid         NOT NULL,
  geo_tag_id       uuid,
  tenant_id        uuid         NOT NULL,
  s3_key           text         NOT NULL,
  original_name    text         NOT NULL,
  description      text,
  uploaded_by      uuid         NOT NULL,
  uploaded_at      timestamptz  NOT NULL DEFAULT now(),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  version          integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_site_photos_project ON geo.project_site_photos (project_id);
