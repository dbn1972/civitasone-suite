-- Purpose: document-service foundation — files, versions, folders, sharing
--          and the workflow (dak/e-Office) module, matching the drizzle
--          schema.ts already shipped in src/modules/*/schema.ts exactly
--          (this migration was the only piece missing — see COMP-003).
-- Rollback: DROP SCHEMA document CASCADE; (destructive — requires explicit approval)
-- Affected services: document-service only
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS document;

-- ── files module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document.files (
  id           uuid         PRIMARY KEY,
  tenant_id    uuid         NOT NULL,
  folder_id    uuid,
  name         varchar(500) NOT NULL,
  mime_type    varchar(128),
  size_bytes   bigint,
  storage_key  varchar(1000),
  tags         text[]       NOT NULL DEFAULT '{}',
  status       varchar(32)  NOT NULL DEFAULT 'active',
  version      integer      NOT NULL DEFAULT 1,
  deleted_at   timestamptz,
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document.file_versions (
  id          uuid         PRIMARY KEY,
  file_id     uuid         NOT NULL,
  tenant_id   uuid         NOT NULL,
  version     integer      NOT NULL,
  storage_key varchar(1000),
  size_bytes  bigint,
  created_by  uuid         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- ── folders module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document.folders (
  id         uuid          PRIMARY KEY,
  tenant_id  uuid          NOT NULL,
  parent_id  uuid,
  name       varchar(500)  NOT NULL,
  path       varchar(2000) NOT NULL DEFAULT '/',
  created_by uuid          NOT NULL,
  updated_by uuid          NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  updated_at timestamptz   NOT NULL DEFAULT now()
);

-- ── sharing module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document.file_shares (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  file_id     uuid        NOT NULL,
  shared_with uuid        NOT NULL,
  permission  varchar(32) NOT NULL DEFAULT 'read',
  revoked_at  timestamptz,
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── workflow module (dak / e-Office) ────────────────────────────

CREATE TABLE IF NOT EXISTS document.daks (
  id               uuid         PRIMARY KEY,
  tenant_id        uuid         NOT NULL,
  file_id          uuid,
  subject          varchar(500) NOT NULL,
  body             text,
  priority         varchar(32)  NOT NULL DEFAULT 'normal',
  status           varchar(32)  NOT NULL DEFAULT 'pending',
  assigned_to      uuid,
  forwarded_by     uuid,
  forwarded_at     timestamptz,
  acknowledged_at  timestamptz,
  due_date         timestamptz,
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document.notings (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL,
  dak_id     uuid        NOT NULL,
  body       text        NOT NULL,
  created_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document.approvals (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  dak_id      uuid        NOT NULL,
  decision    varchar(32),
  remarks     text,
  decided_by  uuid,
  decided_at  timestamptz,
  status      varchar(32) NOT NULL DEFAULT 'pending',
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── indexes ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_document_files_tenant_folder   ON document.files(tenant_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_document_files_tenant_status   ON document.files(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_document_files_tenant_updated  ON document.files(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_file_versions_file    ON document.file_versions(file_id, version);
CREATE INDEX IF NOT EXISTS idx_document_folders_tenant_parent ON document.folders(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_document_file_shares_file      ON document.file_shares(file_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_file_shares_shared    ON document.file_shares(tenant_id, shared_with) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_daks_tenant_assigned  ON document.daks(tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_document_daks_tenant_status    ON document.daks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_document_notings_dak           ON document.notings(dak_id, created_at);
CREATE INDEX IF NOT EXISTS idx_document_approvals_dak         ON document.approvals(dak_id);
CREATE INDEX IF NOT EXISTS idx_document_approvals_tenant      ON document.approvals(tenant_id, status);

-- ── service role grants (guarded — role may not exist yet in local dev) ──
--
-- The document_svc login role is NOT created here. Service login roles (and
-- their passwords) are owned by infra/db/bootstrap/bootstrap_document.sql.
-- A migration must never create a passwordless LOGIN role.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_svc') THEN
    GRANT USAGE ON SCHEMA document TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA document TO document_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA document
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO document_svc;
  END IF;
END $$;

-- ── outbox / inbox (write-path durability + consumer idempotency) ───────

CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _outbox TO document_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO document_svc;
    GRANT USAGE ON SCHEMA _inbox TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _inbox TO document_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO document_svc;
  END IF;
END $$;
