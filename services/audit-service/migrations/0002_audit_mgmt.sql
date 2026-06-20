-- audit-service audit management extension (plan, observation, para, compliance)
-- Run as audit_svc on civitas_audit after 0001_init.sql

CREATE SCHEMA IF NOT EXISTS plan;
CREATE SCHEMA IF NOT EXISTS observation;
CREATE SCHEMA IF NOT EXISTS para;
CREATE SCHEMA IF NOT EXISTS compliance;

-- ── plan module ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plan.audit_plans (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL,
  plan_no      text         NOT NULL,
  title        text         NOT NULL,
  area         text         NOT NULL,
  period_from  date         NOT NULL,
  period_to    date         NOT NULL,
  risk_level   varchar(16)  NOT NULL DEFAULT 'medium',
  status       varchar(24)  NOT NULL DEFAULT 'draft',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, plan_no)
);

CREATE TABLE IF NOT EXISTS plan.audit_plan_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  plan_id         uuid        NOT NULL,
  dept_ref        text        NOT NULL,
  unit_ref        text,
  scheduled_from  date        NOT NULL,
  scheduled_to    date        NOT NULL,
  status          varchar(24) NOT NULL DEFAULT 'scheduled',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan.audit_teams (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  plan_id     uuid        NOT NULL,
  member_ref  text        NOT NULL,
  role        varchar(32) NOT NULL DEFAULT 'auditor',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_plans_tenant ON plan.audit_plans (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_plan_items_plan ON plan.audit_plan_items (plan_id);

-- ── observation module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS observation.audit_observations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  obs_no                text        NOT NULL,
  plan_id               uuid,
  auditee_ref           text        NOT NULL,
  finding               text        NOT NULL,
  category              varchar(24) NOT NULL DEFAULT 'compliance',
  risk_level            varchar(16) NOT NULL DEFAULT 'medium',
  amount_involved_minor bigint      NOT NULL DEFAULT 0,
  status                varchar(24) NOT NULL DEFAULT 'open',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_by            uuid        NOT NULL,
  version               integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, obs_no)
);

CREATE TABLE IF NOT EXISTS observation.audit_working_papers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  observation_id  uuid        NOT NULL,
  title           text        NOT NULL,
  content_ref     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_observations_tenant ON observation.audit_observations (tenant_id, status);

-- ── para module ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS para.audit_paras (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  para_no               text        NOT NULL,
  observation_id        uuid,
  dept_ref              text        NOT NULL,
  body                  text        NOT NULL,
  category              varchar(24) NOT NULL DEFAULT 'compliance',
  amount_involved_minor bigint      NOT NULL DEFAULT 0,
  source_ref            text,
  status                varchar(24) NOT NULL DEFAULT 'draft',
  issued_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_by            uuid        NOT NULL,
  version               integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, para_no),
  CONSTRAINT chk_audit_para_status CHECK (status IN ('draft','issued','replied','settled','pending_recovery','closed'))
);

CREATE TABLE IF NOT EXISTS para.audit_dept_responses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  para_id          uuid        NOT NULL,
  response_body    text        NOT NULL,
  responded_by_ref text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS para.audit_para_status_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  para_id     uuid        NOT NULL,
  from_status varchar(24) NOT NULL,
  to_status   varchar(24) NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_paras_tenant_status ON para.audit_paras (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_paras_dept ON para.audit_paras (tenant_id, dept_ref);
CREATE INDEX IF NOT EXISTS idx_audit_para_history_para ON para.audit_para_status_history (para_id);

-- ── compliance module ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance.audit_compliance_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  report_no    text        NOT NULL,
  period_from  date        NOT NULL,
  period_to    date        NOT NULL,
  summary      text        NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'draft',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, report_no)
);

CREATE TABLE IF NOT EXISTS compliance.audit_pending_register (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  para_id               uuid        NOT NULL,
  dept_ref              text        NOT NULL,
  amount_involved_minor bigint      NOT NULL DEFAULT 0,
  status                varchar(24) NOT NULL DEFAULT 'pending',
  due_date              date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_by            uuid        NOT NULL,
  version               integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_pending_register_tenant ON compliance.audit_pending_register (tenant_id, status);
