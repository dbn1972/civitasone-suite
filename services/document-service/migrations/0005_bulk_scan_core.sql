-- Purpose: bulk-scan module (GAP-ADMIN-BULK-SCAN-02) core tables - batches, per-file pipeline
--          state, append-only transition log. Own schema `bulk_scan` inside the document DB
--          (module isolation: no JOIN to document.* and no FK across module schemas).
-- Rollback: DROP SCHEMA bulk_scan CASCADE; (destructive - requires explicit approval)
-- Affected services: document-service only (modules/bulk-scan)
-- Additive and idempotent. Safe to re-run.
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS bulk_scan;

-- ── batches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_scan.batches (
  id               uuid         PRIMARY KEY,
  tenant_id        uuid         NOT NULL,
  name             varchar(200) NOT NULL,
  target_folder_id uuid,
  default_tags     text[]       NOT NULL DEFAULT '{}',
  default_doc_type varchar(64),
  link_target      jsonb,
  profile_id       uuid,
  status           varchar(24)  NOT NULL DEFAULT 'open',
  file_count       integer      NOT NULL DEFAULT 0,
  total_bytes      bigint       NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  version          integer      NOT NULL DEFAULT 1,
  created_by       uuid         NOT NULL,
  updated_by       uuid         NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT bulk_scan_batches_status_chk
    CHECK (status IN ('open', 'processing', 'completed', 'cancelled')),
  CONSTRAINT bulk_scan_batches_counts_chk
    CHECK (file_count >= 0 AND total_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bulk_scan_batches_tenant_created ON bulk_scan.batches(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_scan_batches_tenant_status  ON bulk_scan.batches(tenant_id, status);

-- ── batch_files (one row per scanned file; carries the pipeline state) ──
CREATE TABLE IF NOT EXISTS bulk_scan.batch_files (
  id                   uuid          PRIMARY KEY,
  tenant_id            uuid          NOT NULL,
  batch_id             uuid          NOT NULL REFERENCES bulk_scan.batches(id),
  original_name        varchar(500)  NOT NULL,
  mime_type            varchar(128),
  declared_size_bytes  bigint        NOT NULL,
  size_bytes           bigint,
  sha256               char(64),
  storage_key          varchar(1000) NOT NULL,
  state                varchar(24)   NOT NULL DEFAULT 'pending_upload',
  failure_reason       varchar(64),
  failure_detail       varchar(500),
  dead_letter          boolean       NOT NULL DEFAULT false,
  attempts             integer       NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz,
  lease_expires_at     timestamptz,
  lease_owner          uuid,
  scan_status          varchar(24),
  quarantine_key       varchar(1000),
  page_count           integer,
  ocr_mean_confidence  numeric(5,4),
  doc_type             varchar(64),
  classification       jsonb,
  extracted_fields     jsonb,
  pii_flags            jsonb,
  review_reasons       jsonb,
  text_masked_key      varchar(1000),
  searchable_pdf_key   varchar(1000),
  structured_json_key  varchar(1000),
  tags                 text[]        NOT NULL DEFAULT '{}',
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  duplicate_of         uuid,
  duplicate_action     varchar(8),
  canonical_for_hash   boolean       NOT NULL DEFAULT false,
  filed_document_id    uuid,
  filed_at             timestamptz,
  version              integer       NOT NULL DEFAULT 1,
  created_by           uuid          NOT NULL,
  updated_by           uuid          NOT NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT bulk_scan_batch_files_state_chk CHECK (state IN (
    'pending_upload', 'uploaded', 'scanning', 'scan_pending', 'queued', 'ocr_running',
    'extracted', 'needs_review', 'ready_to_file', 'filed', 'failed', 'quarantined',
    'skipped_duplicate', 'skipped', 'cancelled')),
  CONSTRAINT bulk_scan_batch_files_dup_action_chk
    CHECK (duplicate_action IS NULL OR duplicate_action IN ('skip', 'link')),
  CONSTRAINT bulk_scan_batch_files_attempts_chk CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_batch_state ON bulk_scan.batch_files(batch_id, state);
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_tenant_state ON bulk_scan.batch_files(tenant_id, state);
-- Dispatcher: only the two states that are ever picked up by the scheduler.
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_dispatch
  ON bulk_scan.batch_files(state, next_attempt_at, tenant_id)
  WHERE state IN ('queued', 'scan_pending');
-- Heartbeat owner: a worker step that holds the lease (NULL = claimed but step not started / released).
ALTER TABLE bulk_scan.batch_files ADD COLUMN IF NOT EXISTS lease_owner uuid;

-- Lease sweeper: in-flight states only.
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_lease
  ON bulk_scan.batch_files(lease_expires_at)
  WHERE state IN ('scanning', 'ocr_running');
-- Sweeper: abandoned uploads.
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_pending_upload ON bulk_scan.batch_files(created_at) WHERE state = 'pending_upload';
CREATE INDEX IF NOT EXISTS idx_bulk_scan_files_tenant_sha ON bulk_scan.batch_files(tenant_id, sha256) WHERE sha256 IS NOT NULL;
-- Backstop for the duplicate policy: at most one canonical (first-seen) file per content hash per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_scan_files_canonical_hash
  ON bulk_scan.batch_files(tenant_id, sha256) WHERE canonical_for_hash;

-- ── file_events (append-only transition log) ────────────────────
CREATE TABLE IF NOT EXISTS bulk_scan.file_events (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL,
  file_id    uuid        NOT NULL,
  batch_id   uuid        NOT NULL,
  from_state varchar(24),
  to_state   varchar(24) NOT NULL,
  actor_id   uuid,
  reason     varchar(64),
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only must hold for the table OWNER too (when the service role ran the migration it owns the table and
-- GRANT/REVOKE does not bind an owner): a trigger refuses every UPDATE / DELETE, and a statement-level BEFORE TRUNCATE trigger
-- refuses TRUNCATE (not needed by any path).
-- RESIDUAL RISK: where the application role OWNS the table (migrations run as document_svc) the triggers only stop accidental /
-- ordinary DML: an owner can still DROP / DISABLE the trigger or replace the function. For a hard guarantee run the migrations
-- as a dedicated owner role (see the civitas.document_migration_owner block at the end of this file): then document_svc holds DML only.
CREATE OR REPLACE FUNCTION bulk_scan.file_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'bulk_scan.file_events is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$fn$;
DROP TRIGGER IF EXISTS trg_bulk_scan_file_events_append_only ON bulk_scan.file_events;
CREATE TRIGGER trg_bulk_scan_file_events_append_only
  BEFORE UPDATE OR DELETE ON bulk_scan.file_events
  FOR EACH ROW EXECUTE FUNCTION bulk_scan.file_events_append_only();
DROP TRIGGER IF EXISTS trg_bulk_scan_file_events_no_truncate ON bulk_scan.file_events;
CREATE TRIGGER trg_bulk_scan_file_events_no_truncate
  BEFORE TRUNCATE ON bulk_scan.file_events
  FOR EACH STATEMENT EXECUTE FUNCTION bulk_scan.file_events_append_only();

CREATE INDEX IF NOT EXISTS idx_bulk_scan_file_events_file  ON bulk_scan.file_events(file_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bulk_scan_file_events_batch ON bulk_scan.file_events(tenant_id, batch_id, created_at);

-- ── row level security (FORCE; policy = current_tenant_id() from 0002) ──
ALTER TABLE bulk_scan.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.batches;
CREATE POLICY tenant_isolation ON bulk_scan.batches
  USING (tenant_id = current_tenant_id());

ALTER TABLE bulk_scan.batch_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.batch_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.batch_files;
CREATE POLICY tenant_isolation ON bulk_scan.batch_files
  USING (tenant_id = current_tenant_id());

ALTER TABLE bulk_scan.file_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.file_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.file_events;
CREATE POLICY tenant_isolation ON bulk_scan.file_events
  USING (tenant_id = current_tenant_id());

-- ── service role grants (guarded - role may not exist in local dev) ──
-- file_events is append-only: the service role gets SELECT + INSERT only.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_svc') THEN
    GRANT USAGE ON SCHEMA bulk_scan TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.batches TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.batch_files TO document_svc;
    GRANT SELECT, INSERT ON bulk_scan.file_events TO document_svc;
  END IF;
END $$;

-- ── optional dedicated MIGRATION OWNER (hardening) ───────────────────────────────────────────────
-- ONE helper, created here and CALLED at the end of 0005, 0006 and 0008 (idempotent; SECURITY INVOKER, so the caller must be
-- able to ALTER the objects: run the migrations as a superuser or as the owner role).
-- When `civitas.document_migration_owner` is set (psql: PGOPTIONS="-c civitas.document_migration_owner=<role>", i.e. the
-- DOCUMENT_MIGRATION_OWNER env of the deploy tooling) every bulk_scan object (schema, tables, functions, sequences) is owned by
-- that role and document_svc keeps DML ONLY (no ownership, no TRUNCATE, no TRIGGER, no DDL), so a compromised service role
-- cannot drop / disable the file_events append-only triggers or replace their function. When the setting is absent it is a
-- no-op (migrations run as the service role, which then owns the tables).
CREATE OR REPLACE FUNCTION bulk_scan.apply_migration_owner() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE
  o text := nullif(current_setting('civitas.document_migration_owner', true), '');
  r record;
BEGIN
  IF o IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = o) THEN
    RAISE EXCEPTION 'civitas.document_migration_owner role % does not exist', o;
  END IF;
  EXECUTE format('ALTER SCHEMA bulk_scan OWNER TO %I', o);
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'bulk_scan' AND c.relkind IN ('r', 'p', 'S') LOOP
    EXECUTE format('ALTER %s bulk_scan.%I OWNER TO %I', CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname, o);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'bulk_scan' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.sig, o);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_svc') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA bulk_scan FROM document_svc';
    EXECUTE 'REVOKE ALL ON SCHEMA bulk_scan FROM document_svc';
    EXECUTE 'GRANT USAGE ON SCHEMA bulk_scan TO document_svc';
    FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'bulk_scan' AND c.relkind IN ('r', 'p') LOOP
      IF r.relname = 'file_events' THEN
        EXECUTE 'GRANT SELECT, INSERT ON bulk_scan.file_events TO document_svc';
      ELSE
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.%I TO document_svc', r.relname);
      END IF;
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_scanner') AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'bulk_scan' AND tablename = 'batch_files') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bulk_scan TO document_scanner';
    EXECUTE 'GRANT SELECT ON bulk_scan.batch_files TO document_scanner';
  END IF;
END
$fn$;

SELECT bulk_scan.apply_migration_owner();
