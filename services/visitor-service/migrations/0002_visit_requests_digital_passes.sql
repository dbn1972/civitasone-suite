-- Migration: 0002_visit_requests_digital_passes.sql
-- Purpose: Core visit-request and digital-pass entities for visitor-service
--          (visitor.visit_requests, visitor.digital_passes) per the design's
--          Drizzle schema (modules/visit-request/schema.ts, modules/digital-pass/schema.ts)
-- Depends on: 0001_locations_areas_gates_parking.sql (visitor.locations)
-- Rollback: DROP TABLE IF EXISTS visitor.digital_passes; DROP TABLE IF EXISTS visitor.visit_requests;
--           (drop digital_passes first — it FKs to visit_requests)
-- Safety: additive, idempotent (IF NOT EXISTS throughout). Safe to re-run.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS visitor;

-- ── visit_requests ──────────────────────────────────────────────────────────
-- Encrypted PII columns (visitor_name, visitor_phone, visitor_email, identity_doc_ref)
-- are stored as TEXT holding the AES-256-GCM ciphertext envelope produced by
-- shared/pii-crypto.ts encryptedText(), matching the convention used by other
-- PII-bearing services (e.g. hrms-service employee.hrms_employees).
CREATE TABLE IF NOT EXISTS visitor.visit_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  location_id         uuid        NOT NULL REFERENCES visitor.locations(id),
  visitor_id          uuid,
  host_employee_id    uuid        NOT NULL,
  status              varchar(24) NOT NULL DEFAULT 'pending_approval',
  purpose             text,
  scheduled_at        timestamptz,
  valid_from          timestamptz,
  valid_until         timestamptz,
  pass_type           varchar(16) NOT NULL DEFAULT 'single',
  identity_verified   boolean     NOT NULL DEFAULT false,
  identity_method     varchar(24),
  tracking_ref        varchar(12),
  group_visit_id      uuid,
  permitted_areas     jsonb       NOT NULL DEFAULT '[]',
  rejection_reason    text,
  visitor_category    varchar(16) NOT NULL DEFAULT 'standard',
  source              varchar(16) NOT NULL DEFAULT 'portal',
  visitor_name        text        NOT NULL, -- encrypted (enc:v2:... envelope)
  visitor_phone       text        NOT NULL, -- encrypted
  visitor_email       text,                 -- encrypted, nullable
  identity_doc_type   varchar(24),
  identity_doc_ref    text,                 -- encrypted, nullable
  photo_ref           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

ALTER TABLE visitor.visit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.visit_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.visit_requests;
DROP POLICY IF EXISTS tenant_isolation ON visitor.visit_requests;
CREATE POLICY tenant_isolation_policy ON visitor.visit_requests
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_visit_requests_tenant_location_status
  ON visitor.visit_requests (tenant_id, location_id, status);

CREATE INDEX IF NOT EXISTS idx_visitor_visit_requests_tenant_tracking_ref
  ON visitor.visit_requests (tenant_id, tracking_ref);

-- ── digital_passes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor.digital_passes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  visit_request_id    uuid        NOT NULL REFERENCES visitor.visit_requests(id),
  location_id         uuid        NOT NULL REFERENCES visitor.locations(id),
  pass_number         varchar(12) NOT NULL,
  status              varchar(16) NOT NULL DEFAULT 'active',
  pass_type           varchar(16) NOT NULL,
  qr_jwt              text        NOT NULL,
  valid_from          timestamptz NOT NULL,
  valid_until         timestamptz NOT NULL,
  permitted_areas     jsonb       NOT NULL DEFAULT '[]',
  revoked             boolean     NOT NULL DEFAULT false,
  revoked_at          timestamptz,
  revoke_reason       text,
  replaced_by_id      uuid        REFERENCES visitor.digital_passes(id),
  escort_employee_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, pass_number)
);

ALTER TABLE visitor.digital_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.digital_passes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON visitor.digital_passes;
DROP POLICY IF EXISTS tenant_isolation ON visitor.digital_passes;
CREATE POLICY tenant_isolation_policy ON visitor.digital_passes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_visitor_digital_passes_tenant_visit_request
  ON visitor.digital_passes (tenant_id, visit_request_id);

CREATE INDEX IF NOT EXISTS idx_visitor_digital_passes_tenant_status
  ON visitor.digital_passes (tenant_id, status);
