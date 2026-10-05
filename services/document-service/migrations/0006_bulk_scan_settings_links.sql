-- Purpose: bulk-scan module - per-tenant settings (+ maker-checker change requests), scan
--          profiles, and the link table used by the (separately built) link orchestration.
-- Rollback: DROP TABLE bulk_scan.links, bulk_scan.profiles, bulk_scan.settings_change_requests,
--           bulk_scan.settings; (destructive - requires explicit approval)
-- Affected services: document-service only (modules/bulk-scan)
-- Additive and idempotent. Safe to re-run. Requires 0005 (schema bulk_scan) and 0002 (current_tenant_id()).
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS bulk_scan;

-- ── settings: ONE row per tenant. `config` is the full validated settings document
--    (zod-validated on every write and every read; see modules/bulk-scan/validators.ts).
CREATE TABLE IF NOT EXISTS bulk_scan.settings (
  id         uuid        PRIMARY KEY,
  tenant_id  uuid        NOT NULL,
  config     jsonb       NOT NULL,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bulk_scan_settings_tenant UNIQUE (tenant_id)
);

-- ── settings_change_requests: maker-checker for settings changes ──
CREATE TABLE IF NOT EXISTS bulk_scan.settings_change_requests (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL,
  proposed        jsonb       NOT NULL,
  base_version    integer     NOT NULL DEFAULT 0,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  maker           uuid        NOT NULL,
  checker         uuid,
  reason          text,
  decision_reason text,
  sensitive       boolean     NOT NULL DEFAULT false,
  -- 'settings' = replace the tenant settings with `proposed`; 'profile' = create / update / delete a scan profile that
  -- overrides a sensitive field (providerChain, reviewThreshold, classification thresholds): `profile_id` + `profile_change`
  -- ({op, name?, description?, config?, expectedVersion?}) carry the operation, `proposed` is then {} and unused.
  kind            varchar(16) NOT NULL DEFAULT 'settings',
  profile_id      uuid,
  profile_change  jsonb,
  decided_at      timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_scan_scr_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  -- Defence in depth: even a buggy writer cannot record the maker as the checker.
  CONSTRAINT bulk_scan_scr_maker_checker_chk CHECK (checker IS NULL OR checker <> maker)
);

-- Re-runs on a database that already has the table without the profile columns.
ALTER TABLE bulk_scan.settings_change_requests ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'settings';
ALTER TABLE bulk_scan.settings_change_requests ADD COLUMN IF NOT EXISTS profile_id uuid;
ALTER TABLE bulk_scan.settings_change_requests ADD COLUMN IF NOT EXISTS profile_change jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bulk_scan_scr_kind_chk') THEN
    ALTER TABLE bulk_scan.settings_change_requests ADD CONSTRAINT bulk_scan_scr_kind_chk
      CHECK (kind IN ('settings', 'profile') AND (kind = 'settings' OR (profile_id IS NOT NULL AND profile_change IS NOT NULL)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bulk_scan_scr_tenant_status ON bulk_scan.settings_change_requests(tenant_id, status, created_at DESC);

-- ── profiles: named presets a batch can pick ─────────────────────
CREATE TABLE IF NOT EXISTS bulk_scan.profiles (
  id          uuid         PRIMARY KEY,
  tenant_id   uuid         NOT NULL,
  name        varchar(120) NOT NULL,
  description varchar(500),
  config      jsonb        NOT NULL,
  version     integer      NOT NULL DEFAULT 1,
  deleted_at  timestamptz,
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_scan_profiles_tenant_name
  ON bulk_scan.profiles(tenant_id, lower(name)) WHERE deleted_at IS NULL;

-- ── links: scanned file -> HR / Finance / eOffice record (orchestration is built separately) ──
CREATE TABLE IF NOT EXISTS bulk_scan.links (
  id            uuid         PRIMARY KEY,
  tenant_id     uuid         NOT NULL,
  file_id       uuid         NOT NULL,
  document_id   uuid,
  target        varchar(32)  NOT NULL,
  target_id     varchar(128) NOT NULL,
  state         varchar(24)  NOT NULL DEFAULT 'requested',
  requested_by  uuid         NOT NULL,
  approved_by   uuid,
  reason        text,
  finance_hint  jsonb,
  version       integer      NOT NULL DEFAULT 1,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT bulk_scan_links_target_chk CHECK (target IN
    ('hr_employee', 'finance_payment', 'finance_voucher', 'finance_bill', 'eoffice_file')),
  CONSTRAINT bulk_scan_links_state_chk CHECK (state IN
    ('requested', 'awaiting_approval', 'linked', 'rejected', 'flagged_mismatch', 'unlink_requested', 'unlinked'))
);

CREATE INDEX IF NOT EXISTS idx_bulk_scan_links_file   ON bulk_scan.links(tenant_id, file_id);
CREATE INDEX IF NOT EXISTS idx_bulk_scan_links_target ON bulk_scan.links(tenant_id, target, target_id);
CREATE INDEX IF NOT EXISTS idx_bulk_scan_links_state  ON bulk_scan.links(tenant_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_scan_links_active
  ON bulk_scan.links(tenant_id, file_id, target, target_id) WHERE state NOT IN ('rejected', 'unlinked');

-- ── row level security (FORCE) ──────────────────────────────────
ALTER TABLE bulk_scan.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.settings;
CREATE POLICY tenant_isolation ON bulk_scan.settings
  USING (tenant_id = current_tenant_id());

ALTER TABLE bulk_scan.settings_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.settings_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.settings_change_requests;
CREATE POLICY tenant_isolation ON bulk_scan.settings_change_requests
  USING (tenant_id = current_tenant_id());

ALTER TABLE bulk_scan.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.profiles;
CREATE POLICY tenant_isolation ON bulk_scan.profiles
  USING (tenant_id = current_tenant_id());

ALTER TABLE bulk_scan.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_scan.links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulk_scan.links;
CREATE POLICY tenant_isolation ON bulk_scan.links
  USING (tenant_id = current_tenant_id());

-- ── service role grants (guarded) ───────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_svc') THEN
    GRANT USAGE ON SCHEMA bulk_scan TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.settings TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.settings_change_requests TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.profiles TO document_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bulk_scan.links TO document_svc;
  END IF;
END $$;

-- dedicated migration owner (civitas.document_migration_owner): see bulk_scan.apply_migration_owner() in 0005
SELECT bulk_scan.apply_migration_owner();
