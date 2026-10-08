-- citizen-service migration 0037 — GAP-CITIZEN-DOCUMENTS-02: DigiLocker OAuth
-- consent flow. Two additive, idempotent tables in the existing `documents`
-- schema (same bounded context as documents.submissions, created in 0016):
--
--   documents.digilocker_oauth_states — a short-lived, server-stored OAuth
--     authorize-state + PKCE verifier, bound to {tenant, actor, citizen,
--     docType, purpose} with a TTL. The `state` value handed to the provider
--     is opaque; the callback looks the row up to re-bind the exchange to the
--     ORIGINAL actor/tenant (anti-CSRF / anti-fixation) and recover the PKCE
--     verifier that was never sent to the browser.
--
--   documents.digilocker_consents — the persisted DPDP consent record a fetch
--     REQUIRES: who (actor) consented for which citizen, the purpose, docType,
--     scope, grantedAt, expiresAt, revokedAt. A document pull is only allowed
--     while a live (not expired, not revoked) consent row exists.
--
-- RLS mirrors 0007/0015/0016 (portal.current_tenant_id()); ownership → citizen_svc.

SET lock_timeout = '5s';

-- ── OAuth authorize-state + PKCE store (server-side, TTL) ──────────────────
CREATE TABLE IF NOT EXISTS documents.digilocker_oauth_states (
  state           text PRIMARY KEY,              -- opaque, high-entropy; sent to provider
  tenant_id       uuid NOT NULL,
  actor_id        uuid NOT NULL,                 -- the operator who began the flow (JWT sub)
  citizen_id      uuid,                          -- the citizen the document is for
  doc_type        varchar(64) NOT NULL,
  purpose         varchar(120) NOT NULL,
  scope           varchar(120) NOT NULL DEFAULT 'avs_parent_file',
  code_verifier   text NOT NULL,                 -- PKCE verifier, NEVER sent to the browser
  code_challenge  text NOT NULL,                 -- S256(code_verifier), sent to provider
  redirect_uri    text NOT NULL,
  application_id  uuid,
  service_id      uuid,
  consumed_at     timestamptz,                   -- set when the callback exchanges this state
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dl_oauth_states_tenant
  ON documents.digilocker_oauth_states (tenant_id, expires_at);

-- ── Persisted DPDP consent record ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents.digilocker_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  actor_id        uuid NOT NULL,                 -- who recorded/holds the consent (JWT sub)
  citizen_id      uuid,                          -- the data principal the consent is for
  purpose         varchar(120) NOT NULL,
  doc_type        varchar(64) NOT NULL,
  scope           varchar(120) NOT NULL DEFAULT 'avs_parent_file',
  state_ref       text,                          -- the oauth state this consent was granted under
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  row_version     integer NOT NULL DEFAULT 1
);
-- A fetch looks up a LIVE consent for (tenant, citizen, docType); index that path.
CREATE INDEX IF NOT EXISTS ix_dl_consents_tenant_citizen_doc
  ON documents.digilocker_consents (tenant_id, citizen_id, doc_type);
CREATE INDEX IF NOT EXISTS ix_dl_consents_tenant_expiry
  ON documents.digilocker_consents (tenant_id, expires_at);

-- ── Row Level Security — mirror 0016 (portal.current_tenant_id()) ──────────
ALTER TABLE documents.digilocker_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.digilocker_oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents.digilocker_oauth_states;
CREATE POLICY tenant_isolation ON documents.digilocker_oauth_states
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE documents.digilocker_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.digilocker_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents.digilocker_consents;
CREATE POLICY tenant_isolation ON documents.digilocker_consents
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- ── Ownership → citizen_svc (idempotent; harmless when already owned) ──────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citizen_svc') THEN
    ALTER TABLE documents.digilocker_oauth_states OWNER TO citizen_svc;
    ALTER TABLE documents.digilocker_consents     OWNER TO citizen_svc;
  END IF;
END $$;

-- Rollback:
--   DROP TABLE IF EXISTS documents.digilocker_consents;
--   DROP TABLE IF EXISTS documents.digilocker_oauth_states;
