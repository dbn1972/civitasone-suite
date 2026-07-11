-- Migration: 0003_check_ins_blacklist_watchlist.sql
-- Purpose: Gate check-in records and security screening lists for visitor-service
--          (visitor.check_ins, visitor.blacklist_entries, visitor.watchlist_entries)
--          per the design's Drizzle schema (modules/check-in/schema.ts,
--          modules/blacklist/schema.ts)
-- Depends on: 0001_locations_areas_gates_parking.sql (visitor.locations, visitor.gates),
--             0002_visit_requests_digital_passes.sql (visitor.digital_passes)
-- Rollback: DROP TABLE IF EXISTS visitor.check_ins; DROP TABLE IF EXISTS visitor.watchlist_entries;
--           DROP TABLE IF EXISTS visitor.blacklist_entries;
--           (all three are leaf tables — no other table FKs to them)
-- Safety: additive, idempotent (IF NOT EXISTS throughout). Safe to re-run.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- ── check_ins ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.check_ins (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  pass_id               uuid        NOT NULL REFERENCES visitor.digital_passes(id),
  location_id           uuid        NOT NULL REFERENCES visitor.locations(id),
  gate_id               uuid        NOT NULL REFERENCES visitor.gates(id),
  direction             varchar(8)  NOT NULL CHECK (direction IN ('in', 'out')),
  "timestamp"           timestamptz NOT NULL DEFAULT now(),
  gate_terminal_id      varchar(64),
  offline_recorded      boolean     NOT NULL DEFAULT false,
  synced_at             timestamptz,
  verification_method   varchar(16) NOT NULL DEFAULT 'qr',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL
);

ALTER TABLE visitor.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.check_ins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.check_ins;
DROP POLICY IF EXISTS tenant_isolation ON visitor.check_ins;
CREATE POLICY tenant_isolation_policy ON visitor.check_ins
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_check_ins_tenant_pass
  ON visitor.check_ins (tenant_id, pass_id);

CREATE INDEX IF NOT EXISTS idx_visitor_check_ins_tenant_gate
  ON visitor.check_ins (tenant_id, gate_id);

-- ── blacklist_entries ────────────────────────────────────────────────────────
-- person_name is an encrypted PII column, stored as TEXT holding the
-- AES-256-GCM ciphertext envelope produced by shared/pii-crypto.ts
-- encryptedText(), matching the convention used elsewhere in this schema
-- (e.g. visitor.visit_requests visitor_name/visitor_phone).
-- identity_doc_hash is a deterministic HMAC blind index (plain hex text, NOT
-- encrypted) so that screening lookups can match on the hash without
-- decrypting any PII, per the design's DPDP "Blind Index" compliance note.
CREATE TABLE IF NOT EXISTS visitor.blacklist_entries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  location_id         uuid        REFERENCES visitor.locations(id), -- null = all locations
  person_name         text        NOT NULL, -- encrypted (enc:v2:... envelope)
  identity_doc_type   varchar(24),
  identity_doc_hash   text,                 -- HMAC blind index, plain hex (not encrypted)
  reason              text        NOT NULL,
  effective_from      timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  status              varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'archived')),
  approved_by         uuid,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.blacklist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.blacklist_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.blacklist_entries;
DROP POLICY IF EXISTS tenant_isolation ON visitor.blacklist_entries;
CREATE POLICY tenant_isolation_policy ON visitor.blacklist_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Fast screening lookup: hash a visitor's identity document and check membership.
CREATE INDEX IF NOT EXISTS idx_visitor_blacklist_entries_identity_doc_hash
  ON visitor.blacklist_entries (identity_doc_hash);

CREATE INDEX IF NOT EXISTS idx_visitor_blacklist_entries_tenant_status
  ON visitor.blacklist_entries (tenant_id, status);

-- ── watchlist_entries ────────────────────────────────────────────────────────
-- Same encrypted-PII / blind-index convention as blacklist_entries above.
CREATE TABLE IF NOT EXISTS visitor.watchlist_entries (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  location_id            uuid        REFERENCES visitor.locations(id), -- null = all locations
  person_name            text        NOT NULL, -- encrypted (enc:v2:... envelope)
  identity_doc_type      varchar(24),
  identity_doc_hash      text,                 -- HMAC blind index, plain hex (not encrypted)
  risk_level             varchar(8)  NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
  special_instructions   text,
  active                 boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid        NOT NULL,
  version                integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.watchlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.watchlist_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.watchlist_entries;
DROP POLICY IF EXISTS tenant_isolation ON visitor.watchlist_entries;
CREATE POLICY tenant_isolation_policy ON visitor.watchlist_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Fast screening lookup: hash a visitor's identity document and check membership.
CREATE INDEX IF NOT EXISTS idx_visitor_watchlist_entries_identity_doc_hash
  ON visitor.watchlist_entries (identity_doc_hash);
