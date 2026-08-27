-- Purpose: create the Postgres schemas/tables/enums for five admin-service
--   modules whose Drizzle schema files (custom-domains, webhooks,
--   data-export, scheduled-jobs, feature-flags) were written and wired into
--   live HTTP routes + consumers, but whose actual tables were NEVER
--   created by any prior migration and whose schema objects were never
--   registered in shared/db.ts's SCHEMA map. Every read/write against these
--   five modules has been throwing `relation "X.Y" does not exist` (500) in
--   any real database. This was masked in tests because existing route
--   tests asserted loose status-code sets (e.g. `[200, 404, 500]`) instead
--   of the actual persisted result.
--
--   Migration 0006 (rls_full_tenant_isolation) already contains RLS
--   policies referencing custom_domains.custom_domains, webhooks.webhooks,
--   data_export.export_requests, feature_flags.feature_flags,
--   scheduled_jobs.scheduled_jobs / job_execution_history — i.e. it was
--   written assuming these tables already existed. This migration supplies
--   the tables 0006 was always meant to sit on top of; 0006 is idempotent
--   (DROP POLICY IF EXISTS / CREATE POLICY) so it can be safely re-run
--   after this migration if the policies did not take effect the first
--   time round (ALTER TABLE ... ENABLE ROW LEVEL SECURITY on a
--   nonexistent table would itself have errored, so 0006 must have no-op'd
--   or errored on these five tables previously — re-running it now is the
--   correct remediation, not folded into this file, to keep this migration
--   purely additive/create-only).
--
-- Rollback: DROP SCHEMA custom_domains CASCADE; DROP SCHEMA webhooks CASCADE;
--   DROP SCHEMA data_export CASCADE; DROP SCHEMA scheduled_jobs CASCADE;
--   DROP SCHEMA feature_flags CASCADE;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS custom_domains;
CREATE SCHEMA IF NOT EXISTS webhooks;
CREATE SCHEMA IF NOT EXISTS data_export;
CREATE SCHEMA IF NOT EXISTS scheduled_jobs;
CREATE SCHEMA IF NOT EXISTS feature_flags;

-- ── custom_domains module ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE custom_domains.domain_status AS ENUM ('pending_verification', 'verified', 'active', 'failed', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE custom_domains.verification_method AS ENUM ('dns_txt', 'dns_cname');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE custom_domains.ssl_status AS ENUM ('pending', 'issued', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS custom_domains.custom_domains (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  domain               varchar(253) NOT NULL,
  status               custom_domains.domain_status NOT NULL DEFAULT 'pending_verification',
  verification_token   varchar(100) NOT NULL,
  verification_method  custom_domains.verification_method NOT NULL DEFAULT 'dns_txt',
  verified_at          timestamptz,
  ssl_status           custom_domains.ssl_status NOT NULL DEFAULT 'pending',
  ssl_expires_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_custom_domains_tenant ON custom_domains.custom_domains(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_domains_domain ON custom_domains.custom_domains(domain);

-- ── webhooks module ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhooks.webhooks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  url           text NOT NULL,
  events        jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret        text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  description   varchar(500) DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks.webhooks(tenant_id);

-- webhook_deliveries has no tenant_id of its own — it is a child of
-- webhooks.webhooks (via webhook_id) and is always accessed through a join
-- or an application-layer lookup scoped by the parent's tenant. No RLS
-- policy is defined for this table (matches migration 0006, which likewise
-- has no policy for it) since it carries no tenant_id column to key on.
CREATE TABLE IF NOT EXISTS webhooks.webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES webhooks.webhooks(id) ON DELETE CASCADE,
  event_type      varchar(200) NOT NULL,
  payload         jsonb NOT NULL,
  status_code     integer,
  response_body   text,
  attempt         integer NOT NULL DEFAULT 1,
  delivered_at    timestamptz,
  next_retry_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhooks.webhook_deliveries(webhook_id, created_at DESC);

-- ── data_export module ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE data_export.export_type AS ENUM ('full', 'module', 'entity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_export.export_format AS ENUM ('csv', 'json', 'pdf');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_export.export_status AS ENUM ('pending', 'processing', 'ready', 'expired', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS data_export.export_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  requested_by      uuid NOT NULL,
  type              data_export.export_type NOT NULL,
  module_filter     varchar(100),
  format            data_export.export_format NOT NULL,
  status            data_export.export_status NOT NULL DEFAULT 'pending',
  download_url      text,
  file_size_bytes   integer,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_export_requests_tenant ON data_export.export_requests(tenant_id, created_at DESC);

-- ── scheduled_jobs module ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE scheduled_jobs.job_run_status AS ENUM ('success', 'failed', 'running', 'never_run');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS scheduled_jobs.scheduled_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  name             varchar(200) NOT NULL,
  description      text NOT NULL DEFAULT '',
  cron_expression  varchar(100) NOT NULL,
  timezone         varchar(50) NOT NULL DEFAULT 'Asia/Kolkata',
  target_service   varchar(100) NOT NULL,
  target_command   varchar(200) NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean NOT NULL DEFAULT true,
  last_run_at      timestamptz,
  last_run_status  scheduled_jobs.job_run_status NOT NULL DEFAULT 'never_run',
  next_run_at      timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_tenant ON scheduled_jobs.scheduled_jobs(tenant_id);

CREATE TABLE IF NOT EXISTS scheduled_jobs.job_execution_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  job_id         uuid NOT NULL REFERENCES scheduled_jobs.scheduled_jobs(id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  duration_ms    integer,
  status         scheduled_jobs.job_run_status NOT NULL DEFAULT 'running',
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_execution_history_tenant ON scheduled_jobs.job_execution_history(tenant_id, job_id, started_at DESC);

-- ── feature_flags module ───────────────────────────────────────────────
-- NOTE: distinct from config.admin_feature_flags (the platform-wide flag
-- registry with per-tenant `overrides` jsonb). This is the tenant-scoped
-- "manage" screen's own flag table (routes.ts: /v1/admin/feature-flags/manage).

CREATE TABLE IF NOT EXISTS feature_flags.feature_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  key              varchar(128) NOT NULL,
  name             varchar(200) NOT NULL,
  description      text NOT NULL DEFAULT '',
  enabled          boolean NOT NULL DEFAULT false,
  rollout_percent  integer NOT NULL DEFAULT 0,
  target_segments  jsonb NOT NULL DEFAULT '[]'::jsonb,
  kill_switch      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant ON feature_flags.feature_flags(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_tenant_key ON feature_flags.feature_flags(tenant_id, key);
