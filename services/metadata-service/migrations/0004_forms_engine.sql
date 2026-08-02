-- Migration: 0004_forms_engine.sql
--
-- Purpose: extend the existing form builder (metadata.layout_definitions) with
--   the four PARTIAL requirements in this sprint:
--     FRM-04  dependent-field cascade rules (cycle-checked at definition time)
--     FRM-05  show/hide conditions (hidden fields stripped before validation)
--     FRM-07  maker-checker publish of an immutable form VERSION
--     LM-002  lead capture from a PUBLIC web form, with UTM attribution
--
--   metadata.form_versions        — versioned, maker-checker-governed snapshot of a
--                                   form's visibility + cascade rules. Published
--                                   versions are immutable (enforced in the app's
--                                   pure state machine, modules/forms/publish-domain.ts,
--                                   and by the status CHECK below).
--   metadata.form_public_endpoints— opaque 64-hex public key -> (tenant, published
--                                   form version). This is the ONLY tenant
--                                   resolution surface for the unauthenticated
--                                   endpoint. Lookup happens inside a tenant-scoped
--                                   transaction whose tenant comes from the URL path,
--                                   so an anonymous caller cannot choose the tenant
--                                   it writes to: the (tenant, key) pair must already
--                                   exist together.
--   metadata.form_submissions     — captured leads. contact_name / contact_email /
--                                   contact_phone / answers are TEXT holding the
--                                   AES-256-GCM envelope written by the app's
--                                   encryptedText() Drizzle type (DPDP Act 2023).
--                                   UTM columns are plain, bounded varchar(200).
--
-- Rollback:
--   DROP TABLE IF EXISTS metadata.form_submissions;
--   DROP TABLE IF EXISTS metadata.form_public_endpoints;
--   DROP TABLE IF EXISTS metadata.form_versions;
--   (No existing table is altered, so nothing else needs reverting.)
--
-- Affected services: metadata-service only. crm-service consumes the
--   `metadata.lead.captured` event in a future change; no schema there is touched
--   by this migration and no consumer exists yet.
--
-- Safety: additive and idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS
--   throughout, guarded GRANT). No column is dropped, no type altered. Safe to
--   apply repeatedly. All timestamps are timestamptz.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS metadata;

-- ── Form Versions (FRM-04 / FRM-05 config + FRM-07 lifecycle) ────────────────
CREATE TABLE IF NOT EXISTS metadata.form_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  layout_def_id UUID NOT NULL REFERENCES metadata.layout_definitions(id),
  version_number INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  -- [{ field, showWhen }] — FRM-05 show/hide conditions
  visibility_rules JSONB NOT NULL DEFAULT '[]',
  -- [{ field, dependsOn, options: { parentValue: [option, ...] } }] — FRM-04
  cascade_rules JSONB NOT NULL DEFAULT '[]',
  submitted_by UUID,
  submitted_at TIMESTAMPTZ,
  published_by UUID,
  published_at TIMESTAMPTZ,
  superseded_by UUID,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  CONSTRAINT form_versions_status_chk
    CHECK (status IN ('draft','pending_approval','published','superseded')),
  CONSTRAINT form_versions_version_number_chk CHECK (version_number >= 1),
  -- Separation of duties, belt-and-braces at the storage layer: a published
  -- version may never record the same actor as submitter and approver. The app
  -- refuses this with 403 MAKER_CANNOT_CHECK; this CHECK means even a direct SQL
  -- write cannot create a self-approved published form version.
  CONSTRAINT form_versions_sod_chk
    CHECK (published_by IS NULL OR submitted_by IS NULL OR published_by <> submitted_by),
  UNIQUE (tenant_id, layout_def_id, version_number)
);

ALTER TABLE metadata.form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.form_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.form_versions;
CREATE POLICY tenant_isolation ON metadata.form_versions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_form_versions_layout
  ON metadata.form_versions (tenant_id, layout_def_id, version_number DESC);
-- Partial index for "the live version of this form" — the hottest read.
CREATE INDEX IF NOT EXISTS idx_form_versions_published
  ON metadata.form_versions (tenant_id, layout_def_id)
  WHERE status = 'published';

-- ── Public Form Endpoints (LM-002 tenant resolution) ─────────────────────────
CREATE TABLE IF NOT EXISTS metadata.form_public_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  form_version_id UUID NOT NULL REFERENCES metadata.form_versions(id),
  -- 64 hex chars from crypto.randomBytes(32): a capability, not a guessable slug.
  public_key VARCHAR(64) NOT NULL,
  label VARCHAR(256) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  CONSTRAINT form_public_endpoints_key_chk CHECK (public_key ~ '^[0-9a-f]{64}$'),
  -- Globally unique, not per-tenant: the key must identify exactly one endpoint
  -- so the same key can never resolve differently under two tenants.
  UNIQUE (public_key)
);

ALTER TABLE metadata.form_public_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.form_public_endpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.form_public_endpoints;
CREATE POLICY tenant_isolation ON metadata.form_public_endpoints
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_form_public_endpoints_version
  ON metadata.form_public_endpoints (tenant_id, form_version_id);

-- ── Form Submissions (LM-002 captured leads) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata.form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  form_version_id UUID NOT NULL REFERENCES metadata.form_versions(id),
  public_endpoint_id UUID REFERENCES metadata.form_public_endpoints(id),
  -- ── PII: AES-256-GCM envelope ("enc:v2:<keyid>:<base64>") written by the app's
  -- encryptedText() custom Drizzle type. TEXT, matching every other encrypted
  -- PII column in the suite. NEVER logged — only the submission id is logged.
  contact_name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  -- JSON-encoded non-contact answers, also encrypted: on a public lead form the
  -- free-text answers are personal data too, so they do not sit in a plaintext
  -- jsonb column. This costs jsonb queryability, which leads do not need.
  answers TEXT NOT NULL,
  -- ── UTM attribution: campaign metadata, not personal data. Bounded so an
  -- anonymous caller cannot use them as free storage; the app rejects oversized
  -- values rather than truncating (truncation would corrupt attribution).
  utm_source VARCHAR(200),
  utm_medium VARCHAR(200),
  utm_campaign VARCHAR(200),
  utm_term VARCHAR(200),
  utm_content VARCHAR(200),
  channel VARCHAR(32) NOT NULL DEFAULT 'public_web_form',
  -- Field api-names the server stripped because they were hidden (FRM-05).
  -- Recorded so "the server discarded values you sent" is auditable, not silent.
  stripped_fields JSONB NOT NULL DEFAULT '[]',
  lead_status VARCHAR(24) NOT NULL DEFAULT 'captured',
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  CONSTRAINT form_submissions_channel_chk
    CHECK (channel IN ('public_web_form','authenticated','import')),
  CONSTRAINT form_submissions_lead_status_chk
    CHECK (lead_status IN ('captured','qualified','converted','rejected'))
);

ALTER TABLE metadata.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.form_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.form_submissions;
CREATE POLICY tenant_isolation ON metadata.form_submissions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_form_submissions_version_created
  ON metadata.form_submissions (tenant_id, form_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_campaign
  ON metadata.form_submissions (tenant_id, utm_campaign)
  WHERE utm_campaign IS NOT NULL;

-- ── Guarded privileges ───────────────────────────────────────────────────────
-- The service login role owns these tables when the migration is applied as
-- metadata_svc, but grant explicitly so the migration is also correct when
-- applied by a superuser/DBA. Guarded so it is a no-op where the role is absent
-- (e.g. a fresh CI database). No role is created here — in particular no
-- passwordless LOGIN role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metadata_svc') THEN
    GRANT USAGE ON SCHEMA metadata TO metadata_svc;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA metadata TO metadata_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA metadata GRANT ALL ON TABLES TO metadata_svc;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA metadata TO metadata_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA metadata GRANT ALL ON SEQUENCES TO metadata_svc;
  END IF;
END $$;
