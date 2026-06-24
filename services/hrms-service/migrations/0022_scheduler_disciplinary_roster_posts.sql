-- 0022_scheduler_disciplinary_roster_posts.sql
-- P1 gaps in hrms-service:
--   (1) Scheduled-job layer: due-list snapshots (retirement/superannuation, probation).
--   (2) Disciplinary / Vigilance (CCS CCA Rules) state machine + suspension flag.
--   (3) Reservation roster (post-based, e.g. 100-point) with category vacancy.
--   (4) Sanctioned-post / cadre strength register with vacancy control.
-- Additive + idempotent only. Money (none here). All tenant-scoped.

-- ===========================================================================
-- (1) SCHEDULER — due-list snapshots produced by the worker tick
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS scheduler;

-- One row per (tenant, list_kind, run_date, employee). Idempotent re-runs use
-- the unique constraint so a repeated tick for the same day is a no-op.
CREATE TABLE IF NOT EXISTS scheduler.hrms_due_list (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  list_kind       varchar(32) NOT NULL,   -- 'superannuation' | 'probation'
  run_date        date NOT NULL DEFAULT CURRENT_DATE,
  employee_id     uuid NOT NULL,
  employee_no     text,
  full_name       text,
  due_date        date NOT NULL,          -- superannuation date / probation-end date
  days_remaining  integer NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_due_list_kind_check CHECK (list_kind IN ('superannuation','probation')),
  CONSTRAINT hrms_due_list_uq UNIQUE (tenant_id, list_kind, run_date, employee_id)
);
CREATE INDEX IF NOT EXISTS hrms_due_list_tenant_kind_idx
  ON scheduler.hrms_due_list (tenant_id, list_kind, run_date);

-- Records each scheduler tick so the cadence is auditable / observable.
CREATE TABLE IF NOT EXISTS scheduler.hrms_scheduler_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      varchar(48) NOT NULL,
  run_date      date NOT NULL DEFAULT CURRENT_DATE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  tenants_seen  integer NOT NULL DEFAULT 0,
  rows_produced integer NOT NULL DEFAULT 0,
  status        varchar(16) NOT NULL DEFAULT 'running',
  detail        text,
  CONSTRAINT hrms_scheduler_runs_status_check CHECK (status IN ('running','ok','error')),
  CONSTRAINT hrms_scheduler_runs_uq UNIQUE (job_name, run_date)
);

-- ===========================================================================
-- (2) DISCIPLINARY / VIGILANCE (CCS (CCA) Rules) state machine
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS disciplinary;

-- Case lifecycle:
--   opened -> charge_memo_issued -> inquiry_appointed -> finding_recorded
--          -> penalty_imposed -> (appeal_filed -> appeal_decided) -> closed
--   any -> dropped
CREATE TABLE IF NOT EXISTS disciplinary.hrms_disciplinary_cases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  employee_id        uuid NOT NULL,
  case_no            varchar(48) NOT NULL,
  proceeding_type    varchar(16) NOT NULL DEFAULT 'major',  -- 'minor' | 'major'
  status             varchar(32) NOT NULL DEFAULT 'opened',
  allegation         text NOT NULL,
  -- charge memo
  charge_memo_ref    text,
  charge_memo_date   date,
  -- inquiry officer
  inquiry_officer_id uuid,
  inquiry_officer_name text,
  inquiry_appointed_date date,
  -- finding
  finding            varchar(24),                            -- 'guilty' | 'not_guilty' | 'partly_guilty'
  finding_notes      text,
  finding_date       date,
  -- penalty
  penalty_class      varchar(16),                            -- 'minor' | 'major'
  penalty_type       varchar(48),                            -- e.g. censure, reduction_in_rank, dismissal
  penalty_detail     text,
  penalty_date       date,
  -- appeal
  appeal_filed_date  date,
  appeal_authority   text,
  appeal_outcome     varchar(24),                            -- 'upheld' | 'modified' | 'set_aside'
  appeal_decided_date date,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_disc_cases_ptype_check CHECK (proceeding_type IN ('minor','major')),
  CONSTRAINT hrms_disc_cases_status_check CHECK (status IN
    ('opened','charge_memo_issued','inquiry_appointed','finding_recorded',
     'penalty_imposed','appeal_filed','appeal_decided','closed','dropped')),
  CONSTRAINT hrms_disc_cases_uq UNIQUE (tenant_id, case_no)
);
CREATE INDEX IF NOT EXISTS hrms_disc_cases_emp_idx
  ON disciplinary.hrms_disciplinary_cases (tenant_id, employee_id);

-- Append-only audit of each state transition.
CREATE TABLE IF NOT EXISTS disciplinary.hrms_disciplinary_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  case_id     uuid NOT NULL,
  from_status varchar(32),
  to_status   varchar(32) NOT NULL,
  action      varchar(48) NOT NULL,
  notes       text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS hrms_disc_events_case_idx
  ON disciplinary.hrms_disciplinary_events (tenant_id, case_id, occurred_at);

-- Suspension register. `pay_suspended = true` is the flag the payroll-input
-- projection exposes so payroll can apply subsistence allowance / withhold pay.
CREATE TABLE IF NOT EXISTS disciplinary.hrms_suspensions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  case_id         uuid,
  order_ref       text,
  from_date       date NOT NULL,
  to_date         date,                                       -- null = open-ended
  pay_suspended   boolean NOT NULL DEFAULT true,
  subsistence_pct numeric(5,2) NOT NULL DEFAULT 50.00,        -- subsistence allowance %
  status          varchar(16) NOT NULL DEFAULT 'active',      -- 'active' | 'revoked'
  revoked_date    date,
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_susp_status_check CHECK (status IN ('active','revoked'))
);
CREATE INDEX IF NOT EXISTS hrms_susp_emp_active_idx
  ON disciplinary.hrms_suspensions (tenant_id, employee_id, status);

-- ===========================================================================
-- (3) RESERVATION ROSTER (recruitment)
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS reservation;

-- A roster is defined per cadre/post with a roster size (points) and the
-- category reservation percentages. Carry-forward backlog is stored per row.
CREATE TABLE IF NOT EXISTS reservation.hrms_rosters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  cadre          varchar(120) NOT NULL,
  roster_kind    varchar(16) NOT NULL DEFAULT 'point100',     -- 'point100' | 'point200'
  roster_size    integer NOT NULL DEFAULT 100,
  pct_sc         numeric(5,2) NOT NULL DEFAULT 15.00,
  pct_st         numeric(5,2) NOT NULL DEFAULT 7.50,
  pct_obc        numeric(5,2) NOT NULL DEFAULT 27.00,
  pct_ews        numeric(5,2) NOT NULL DEFAULT 10.00,
  pct_pwd        numeric(5,2) NOT NULL DEFAULT 4.00,           -- horizontal
  -- carry-forward backlog (vacancies not filled in earlier cycles)
  cf_sc          integer NOT NULL DEFAULT 0,
  cf_st          integer NOT NULL DEFAULT 0,
  cf_obc         integer NOT NULL DEFAULT 0,
  cf_ews         integer NOT NULL DEFAULT 0,
  cf_ur          integer NOT NULL DEFAULT 0,
  status         varchar(16) NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_rosters_kind_check CHECK (roster_kind IN ('point100','point200')),
  CONSTRAINT hrms_rosters_uq UNIQUE (tenant_id, cadre)
);

-- Per-point roster occupancy (which category each post point belongs to and
-- whether it is currently filled). Lets carry-forward be computed precisely.
CREATE TABLE IF NOT EXISTS reservation.hrms_roster_points (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  roster_id    uuid NOT NULL,
  point_no     integer NOT NULL,
  category     varchar(8) NOT NULL,                            -- SC|ST|OBC|EWS|UR
  filled       boolean NOT NULL DEFAULT false,
  employee_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_roster_points_cat_check CHECK (category IN ('SC','ST','OBC','EWS','UR')),
  CONSTRAINT hrms_roster_points_uq UNIQUE (tenant_id, roster_id, point_no)
);

-- ===========================================================================
-- (4) SANCTIONED-POST / CADRE STRENGTH register
-- ===========================================================================
CREATE TABLE IF NOT EXISTS reservation.hrms_sanctioned_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  cadre              varchar(120) NOT NULL,
  designation_id     uuid,
  pay_level          varchar(24),
  sanctioned_strength integer NOT NULL DEFAULT 0,
  status             varchar(16) NOT NULL DEFAULT 'active',
  remarks            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_sanc_posts_status_check CHECK (status IN ('active','frozen')),
  CONSTRAINT hrms_sanc_posts_uq UNIQUE (tenant_id, cadre)
);
