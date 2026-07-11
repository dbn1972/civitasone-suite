-- Migration: 0005_group_recurring.sql
-- Purpose: Group-visit and recurring-pass entities for visitor-service
--          (visitor.group_visits, visitor.group_members, visitor.recurring_passes)
--          per the design's Drizzle schema (modules/group-visit/schema.ts,
--          modules/recurring-pass/schema.ts)
-- Depends on: 0001_locations_areas_gates_parking.sql (visitor.locations),
--             0002_visit_requests_digital_passes.sql (visitor.visit_requests, visitor.digital_passes)
-- Rollback: DROP TABLE IF EXISTS visitor.recurring_passes;
--           DROP TABLE IF EXISTS visitor.group_members;
--           DROP TABLE IF EXISTS visitor.group_visits;
--           (drop group_members before group_visits — it FKs to group_visits;
--           recurring_passes has no incoming FKs so may be dropped independently)
-- Safety: additive, idempotent (IF NOT EXISTS throughout). Safe to re-run.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- ── group_visits ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.group_visits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  group_name        varchar(200) NOT NULL,
  lead_visitor_id   uuid,
  member_count      integer     NOT NULL,
  purpose           text        NOT NULL,
  visit_request_id  uuid        REFERENCES visitor.visit_requests(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.group_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.group_visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.group_visits;
DROP POLICY IF EXISTS tenant_isolation ON visitor.group_visits;
CREATE POLICY tenant_isolation_policy ON visitor.group_visits
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_group_visits_tenant_visit_request
  ON visitor.group_visits (tenant_id, visit_request_id);

-- ── group_members ────────────────────────────────────────────────────────────
-- Encrypted PII columns (member_name, identity_doc_ref) are stored as TEXT
-- holding the AES-256-GCM ciphertext envelope produced by shared/pii-crypto.ts
-- encryptedText(), matching the convention used elsewhere in this schema
-- (e.g. visitor.visit_requests visitor_name/visitor_phone). identity_doc_hash
-- is a deterministic HMAC blind index (not encrypted) enabling blacklist/
-- watchlist lookups without decryption, matching visitor.blacklist_entries.
CREATE TABLE IF NOT EXISTS visitor.group_members (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  group_visit_id     uuid        NOT NULL REFERENCES visitor.group_visits(id),
  member_name        text        NOT NULL, -- encrypted (enc:v2:... envelope)
  identity_doc_type  varchar(24),
  identity_doc_ref   text,                 -- encrypted, nullable
  identity_doc_hash  text,                 -- blind index (HMAC), not encrypted
  pass_id            uuid        REFERENCES visitor.digital_passes(id),
  blacklisted        boolean     NOT NULL DEFAULT false,
  checked_in         boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL
);

ALTER TABLE visitor.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.group_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.group_members;
DROP POLICY IF EXISTS tenant_isolation ON visitor.group_members;
CREATE POLICY tenant_isolation_policy ON visitor.group_members
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_group_members_tenant_group_visit
  ON visitor.group_members (tenant_id, group_visit_id);

-- ── recurring_passes ─────────────────────────────────────────────────────────
-- Encrypted PII columns (visitor_name, visitor_phone) are stored as TEXT
-- holding the AES-256-GCM ciphertext envelope produced by shared/pii-crypto.ts
-- encryptedText(), matching the convention used elsewhere in this schema.
CREATE TABLE IF NOT EXISTS visitor.recurring_passes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  location_id          uuid        NOT NULL REFERENCES visitor.locations(id),
  pass_id              uuid        NOT NULL REFERENCES visitor.digital_passes(id),
  visitor_name         text        NOT NULL, -- encrypted (enc:v2:... envelope)
  visitor_phone        text        NOT NULL, -- encrypted
  company_name         varchar(200),
  valid_from           timestamptz NOT NULL,
  valid_until          timestamptz NOT NULL,
  permitted_days       jsonb       NOT NULL, -- array of ints, 0=Sun..6=Sat
  permitted_time_from  varchar(5),
  permitted_time_to    varchar(5),
  status               varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  suspended_at         timestamptz,
  suspend_reason       text,
  issued_by            uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        NOT NULL,
  version              integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.recurring_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.recurring_passes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.recurring_passes;
DROP POLICY IF EXISTS tenant_isolation ON visitor.recurring_passes;
CREATE POLICY tenant_isolation_policy ON visitor.recurring_passes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_recurring_passes_tenant_location_status
  ON visitor.recurring_passes (tenant_id, location_id, status);

CREATE INDEX IF NOT EXISTS idx_visitor_recurring_passes_tenant_pass
  ON visitor.recurring_passes (tenant_id, pass_id);
