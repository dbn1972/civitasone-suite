-- admin-service initial migration. Applied with admin_svc on civitas_admin.
-- Schemas created here if bootstrap has not yet provisioned admin DB.

CREATE SCHEMA IF NOT EXISTS tenants;
CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS health;
CREATE SCHEMA IF NOT EXISTS backup;
CREATE SCHEMA IF NOT EXISTS support;

-- ── tenants module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants.admin_tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
  domain       varchar(253) NOT NULL UNIQUE,
  edition      varchar(32)  NOT NULL CHECK (edition IN ('govt_dept','psu','small_office')),
  status       varchar(24)  NOT NULL DEFAULT 'draft',
  region       varchar(64)  NOT NULL,
  residency    varchar(64)  NOT NULL,
  settings     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_tenants_status ON tenants.admin_tenants(status);

-- ── config module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config.admin_editions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  edition      varchar(32) NOT NULL CHECK (edition IN ('govt_dept','psu','small_office')),
  label        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS config.admin_module_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  module_key   text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, module_key)
);

CREATE TABLE IF NOT EXISTS config.admin_feature_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  flag_key     text NOT NULL,
  enabled      boolean NOT NULL DEFAULT false,
  overrides    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, flag_key)
);

-- ── health module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS health.admin_health_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  service_name text NOT NULL,
  status       varchar(24) NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_health_service ON health.admin_health_snapshots(service_name, created_at DESC);

-- ── backup module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS backup.admin_backup_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  cron_expr    text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS backup.admin_backup_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  schedule_id  uuid,
  status       varchar(24) NOT NULL DEFAULT 'pending',
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  restore_point text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_backup_runs_tenant ON backup.admin_backup_runs(tenant_id, started_at DESC);

-- ── support module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support.admin_break_glass_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  ticket_id      uuid NOT NULL,
  actor_id       uuid NOT NULL,
  reason         text NOT NULL,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  closed_at      timestamptz,
  correlation_id varchar(64) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_break_glass_open ON support.admin_break_glass_log(tenant_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS support.admin_support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  subject      text NOT NULL,
  status       varchar(24) NOT NULL DEFAULT 'open',
  priority     varchar(16) NOT NULL DEFAULT 'normal',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

-- transactional outbox + inbox
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid NOT NULL,
  actor_id       uuid NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
