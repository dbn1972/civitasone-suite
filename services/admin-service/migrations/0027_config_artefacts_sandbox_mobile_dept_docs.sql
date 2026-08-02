-- Migration: 0027_config_artefacts_sandbox_mobile_dept_docs.sql
--
-- PURPOSE
--   Five world-class-gap rows, all extending existing admin-service modules:
--     WC-010  config-as-artefact  → config.config_artefacts / config_promotions /
--                                   config_env_state   (extends `config` module)
--     WC-009  sandbox + masked refresh → sandbox.* (extends backup / data-export
--                                   job+status pattern; DATA MOVEMENT IS STUBBED)
--     CR-MOB-01 mobile perf monitoring → health.mobile_telemetry_events /
--                                   health.mobile_screen_renders (extends `health`)
--     ORG-07  department template clone → dept_template.department_templates /
--                                   department_instantiations
--     DM-002  document types / mandatory docs / expiry → uploads.document_types /
--                                   document_requirements / documents (extends `uploads`)
--
-- ROLLBACK
--   Forward-only by policy. To reverse manually (destructive, needs tech-lead
--   approval per steering):
--     DROP TABLE IF EXISTS uploads.documents, uploads.document_requirements, uploads.document_types;
--     DROP TABLE IF EXISTS dept_template.department_instantiations, dept_template.department_templates;
--     DROP TABLE IF EXISTS health.mobile_screen_renders, health.mobile_telemetry_events;
--     DROP TABLE IF EXISTS sandbox.refresh_masked_fields, sandbox.refresh_jobs,
--                          sandbox.masking_rules, sandbox.sandbox_environments;
--     DROP TABLE IF EXISTS config.config_env_state, config.config_promotions, config.config_artefacts;
--     DROP SCHEMA IF EXISTS sandbox, dept_template, uploads;
--   No existing table is altered, so a rollback cannot lose pre-existing data.
--
-- AFFECTED SERVICES
--   admin-service only (own database `civitas_admin`). notification-service
--   CONSUMES the new admin.document.expiring / admin.document.expired events
--   (published through the outbox) but needs no schema change here.
--
-- SAFETY
--   Additive + idempotent (CREATE ... IF NOT EXISTS everywhere, no DROP of a
--   pre-existing object, no column type change). All timestamps are timestamptz.
--   Every new tenant-scoped table gets RLS ENABLE + FORCE + tenant_isolation.
--   current_tenant_id() is created by migration 0005 and is intentionally NOT
--   redefined here (it is owned by the bootstrap role).
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS health;
CREATE SCHEMA IF NOT EXISTS sandbox;
CREATE SCHEMA IF NOT EXISTS dept_template;
CREATE SCHEMA IF NOT EXISTS uploads;

-- ═══════════════════════════════════════════════════════════════════════════
-- WC-010 — configuration as a versioned artefact
-- ═══════════════════════════════════════════════════════════════════════════

-- An immutable snapshot of a config set. `artefact_version` is the monotonic
-- artefact sequence per (tenant, set_key); the standard `version` column is the
-- row's optimistic-lock counter (never bumped — these rows are immutable).
CREATE TABLE IF NOT EXISTS config.config_artefacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  set_key           varchar(160) NOT NULL,
  artefact_version  integer NOT NULL,
  entries           jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum          varchar(64) NOT NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT config_artefacts_version_positive CHECK (artefact_version >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_artefacts_set_version
  ON config.config_artefacts (tenant_id, set_key, artefact_version);
CREATE INDEX IF NOT EXISTS idx_config_artefacts_tenant_set
  ON config.config_artefacts (tenant_id, set_key, artefact_version DESC);

-- Maker-checker promotion of an artefact version to a target environment.
-- kind='rollback' records a re-promotion of an EARLIER, already-approved
-- artefact version (see routes.ts for why rollback does not need a 2nd approver).
CREATE TABLE IF NOT EXISTS config.config_promotions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  set_key           varchar(160) NOT NULL,
  artefact_id       uuid NOT NULL,
  artefact_version  integer NOT NULL,
  target_env        varchar(32) NOT NULL,
  kind              varchar(16) NOT NULL DEFAULT 'promote',
  status            varchar(24) NOT NULL DEFAULT 'pending',
  requested_by      uuid NOT NULL,
  approved_by       uuid,
  approved_at       timestamptz,
  rejected_reason   text,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT config_promotions_env_chk    CHECK (target_env IN ('dev','staging','uat','production')),
  CONSTRAINT config_promotions_kind_chk   CHECK (kind IN ('promote','rollback')),
  CONSTRAINT config_promotions_status_chk CHECK (status IN ('pending','promoted','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_config_promotions_tenant
  ON config.config_promotions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_promotions_artefact
  ON config.config_promotions (tenant_id, artefact_id);

-- The artefact version currently live in each environment. Mutable → the
-- `version` column IS the optimistic lock (UPDATE ... WHERE version = $current).
CREATE TABLE IF NOT EXISTS config.config_env_state (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  set_key           varchar(160) NOT NULL,
  environment       varchar(32) NOT NULL,
  artefact_id       uuid NOT NULL,
  artefact_version  integer NOT NULL,
  promoted_by       uuid NOT NULL,
  promoted_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT config_env_state_env_chk CHECK (environment IN ('dev','staging','uat','production'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_env_state_set_env
  ON config.config_env_state (tenant_id, set_key, environment);

-- ═══════════════════════════════════════════════════════════════════════════
-- WC-009 — sandbox environments with masked refresh (orchestration only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sandbox.sandbox_environments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  code                varchar(64) NOT NULL,
  name                varchar(200) NOT NULL,
  source_environment  varchar(32) NOT NULL,
  status              varchar(24) NOT NULL DEFAULT 'registered',
  last_refresh_at     timestamptz,
  notes               text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT sandbox_env_source_chk CHECK (source_environment IN ('dev','staging','uat','production')),
  CONSTRAINT sandbox_env_status_chk CHECK (status IN ('registered','refreshing','ready','disabled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sandbox_env_code
  ON sandbox.sandbox_environments (tenant_id, code);

-- Per-field masking rule. ABSENCE OF A RULE MEANS MASK (fail-closed) — see
-- src/modules/sandbox/domain.ts resolveStrategy(). 'preserve' is the only
-- pass-through and requires an explicit written justification.
CREATE TABLE IF NOT EXISTS sandbox.masking_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  sandbox_id     uuid NOT NULL,
  table_name     varchar(128) NOT NULL,
  field_name     varchar(128) NOT NULL,
  strategy       varchar(24) NOT NULL,
  justification  text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT masking_rules_strategy_chk CHECK (strategy IN ('redact','hash','partial','nullify','preserve'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_masking_rules_field
  ON sandbox.masking_rules (tenant_id, sandbox_id, table_name, field_name);

CREATE TABLE IF NOT EXISTS sandbox.refresh_jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  sandbox_id             uuid NOT NULL,
  source_environment     varchar(32) NOT NULL,
  requested_fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                 varchar(24) NOT NULL DEFAULT 'pending_approval',
  requested_by           uuid NOT NULL,
  approved_by            uuid,
  approved_at            timestamptz,
  rejected_reason        text,
  started_at             timestamptz,
  completed_at           timestamptz,
  -- 'stubbed' records that NO production data was actually copied: this service
  -- only orchestrates. The real copy is a queued boundary (see consumer.ts).
  data_movement          varchar(16) NOT NULL DEFAULT 'stubbed',
  masked_field_count     integer NOT NULL DEFAULT 0,
  preserved_field_count  integer NOT NULL DEFAULT 0,
  failure_reason         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1,
  CONSTRAINT refresh_jobs_status_chk CHECK (status IN
    ('pending_approval','rejected','queued','running','completed','failed')),
  CONSTRAINT refresh_jobs_movement_chk CHECK (data_movement IN ('stubbed','executed'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_tenant
  ON sandbox.refresh_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_sandbox
  ON sandbox.refresh_jobs (tenant_id, sandbox_id);

-- The audit of WHAT was masked. Field NAMES and strategies only — never values.
CREATE TABLE IF NOT EXISTS sandbox.refresh_masked_fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  job_id       uuid NOT NULL,
  table_name   varchar(128) NOT NULL,
  field_name   varchar(128) NOT NULL,
  strategy     varchar(24) NOT NULL,
  rule_source  varchar(16) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  CONSTRAINT refresh_masked_strategy_chk CHECK (strategy IN ('redact','hash','partial','nullify','preserve')),
  CONSTRAINT refresh_masked_source_chk   CHECK (rule_source IN ('rule','default'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_masked_job
  ON sandbox.refresh_masked_fields (tenant_id, job_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- CR-MOB-01 — mobile app performance monitoring
-- ═══════════════════════════════════════════════════════════════════════════

-- Bounds are enforced BOTH by zod at the route boundary and by CHECK
-- constraints here: this data arrives from untrusted mobile clients, so an
-- absurd value must be impossible to persist even if a future code path skips
-- the validator.
CREATE TABLE IF NOT EXISTS health.mobile_telemetry_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  app_version    varchar(32) NOT NULL,
  platform       varchar(16) NOT NULL,
  os_version     varchar(32) NOT NULL DEFAULT '',
  device_model   varchar(64) NOT NULL DEFAULT '',
  cold_start_ms  integer NOT NULL,
  warm_start_ms  integer,
  crash_count    integer NOT NULL DEFAULT 0,
  anr_count      integer NOT NULL DEFAULT 0,
  session_count  integer NOT NULL DEFAULT 1,
  recorded_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT mobile_platform_chk    CHECK (platform IN ('ios','android')),
  CONSTRAINT mobile_cold_start_chk  CHECK (cold_start_ms BETWEEN 0 AND 120000),
  CONSTRAINT mobile_warm_start_chk  CHECK (warm_start_ms IS NULL OR warm_start_ms BETWEEN 0 AND 120000),
  CONSTRAINT mobile_crash_chk       CHECK (crash_count BETWEEN 0 AND 10000),
  CONSTRAINT mobile_anr_chk         CHECK (anr_count BETWEEN 0 AND 10000),
  CONSTRAINT mobile_session_chk     CHECK (session_count BETWEEN 1 AND 100000)
);
CREATE INDEX IF NOT EXISTS idx_mobile_telemetry_tenant_recorded
  ON health.mobile_telemetry_events (tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_telemetry_version
  ON health.mobile_telemetry_events (tenant_id, platform, app_version);

CREATE TABLE IF NOT EXISTS health.mobile_screen_renders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  event_id      uuid NOT NULL,
  platform      varchar(16) NOT NULL,
  app_version   varchar(32) NOT NULL,
  screen        varchar(64) NOT NULL,
  render_ms     integer NOT NULL,
  sample_count  integer NOT NULL DEFAULT 1,
  recorded_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT screen_platform_chk CHECK (platform IN ('ios','android')),
  CONSTRAINT screen_render_chk   CHECK (render_ms BETWEEN 0 AND 60000),
  CONSTRAINT screen_sample_chk   CHECK (sample_count BETWEEN 1 AND 100000)
);
CREATE INDEX IF NOT EXISTS idx_mobile_screen_tenant_screen
  ON health.mobile_screen_renders (tenant_id, screen, recorded_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ORG-07 — department template clone
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dept_template.department_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  code                  varchar(64) NOT NULL,
  name                  varchar(200) NOT NULL,
  source_department_id  uuid,
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- References dropped because they pointed outside this tenant (ORG-07:
  -- a clone must never carry a tenant-crossing reference).
  dropped_refs          jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                varchar(16) NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT dept_templates_status_chk CHECK (status IN ('active','archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dept_templates_code
  ON dept_template.department_templates (tenant_id, code);

CREATE TABLE IF NOT EXISTS dept_template.department_instantiations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  template_id       uuid NOT NULL,
  template_version  integer NOT NULL,
  department_code   varchar(64) NOT NULL,
  department_name   varchar(200) NOT NULL,
  -- Idempotency key makes a repeated instantiate a no-op read, not a 2nd row.
  idempotency_key   varchar(120) NOT NULL,
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dept_inst_idempotency
  ON dept_template.department_instantiations (tenant_id, template_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dept_inst_code
  ON dept_template.department_instantiations (tenant_id, department_code);

-- ═══════════════════════════════════════════════════════════════════════════
-- DM-002 — document types, mandatory documents, expiry
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS uploads.document_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  code                varchar(64) NOT NULL,
  name                varchar(200) NOT NULL,
  category            varchar(32) NOT NULL DEFAULT 'document',
  allowed_extensions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_size_mb         integer NOT NULL DEFAULT 10,
  expiry_required     boolean NOT NULL DEFAULT false,
  expiry_warn_days    integer NOT NULL DEFAULT 30,
  status              varchar(16) NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT document_types_status_chk   CHECK (status IN ('active','retired')),
  CONSTRAINT document_types_category_chk CHECK (category IN ('resume','attachment','document','photo','certificate','licence')),
  CONSTRAINT document_types_size_chk     CHECK (max_size_mb BETWEEN 1 AND 200),
  CONSTRAINT document_types_warn_chk     CHECK (expiry_warn_days BETWEEN 1 AND 365)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_types_code
  ON uploads.document_types (tenant_id, code);

CREATE TABLE IF NOT EXISTS uploads.document_requirements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  context_type        varchar(48) NOT NULL,
  context_key         varchar(120) NOT NULL,
  document_type_code  varchar(64) NOT NULL,
  mandatory           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_requirements_ctx
  ON uploads.document_requirements (tenant_id, context_type, context_key, document_type_code);

CREATE TABLE IF NOT EXISTS uploads.documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  document_type_code  varchar(64) NOT NULL,
  context_type        varchar(48) NOT NULL,
  context_key         varchar(120) NOT NULL,
  subject_id          varchar(120) NOT NULL DEFAULT '',
  -- S3/MinIO object key produced by /v1/admin/uploads/presign. Never file bytes.
  storage_key         text NOT NULL,
  issued_at           timestamptz,
  expires_at          timestamptz,
  status              varchar(16) NOT NULL DEFAULT 'active',
  last_alert_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT documents_status_chk CHECK (status IN ('active','expiring','expired','superseded'))
);
CREATE INDEX IF NOT EXISTS idx_documents_ctx
  ON uploads.documents (tenant_id, context_type, context_key);
CREATE INDEX IF NOT EXISTS idx_documents_expiry
  ON uploads.documents (tenant_id, expires_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Guarded GRANTs — only when the least-privilege service role actually exists
-- (it does not on a bare CI database). NEVER creates a role, so this migration
-- can never introduce a passwordless LOGIN role.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA config, health, sandbox, dept_template, uploads TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA config, health, sandbox, dept_template, uploads TO admin_svc;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA config, health, sandbox, dept_template, uploads TO admin_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox, dept_template, uploads
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_svc;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: ENABLE + FORCE + tenant_isolation on every new tenant-scoped table.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'config.config_artefacts',
    'config.config_promotions',
    'config.config_env_state',
    'sandbox.sandbox_environments',
    'sandbox.masking_rules',
    'sandbox.refresh_jobs',
    'sandbox.refresh_masked_fields',
    'health.mobile_telemetry_events',
    'health.mobile_screen_renders',
    'dept_template.department_templates',
    'dept_template.department_instantiations',
    'uploads.document_types',
    'uploads.document_requirements',
    'uploads.documents'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t);
  END LOOP;
END $$;
