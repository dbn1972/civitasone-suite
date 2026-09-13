-- 0022_scim_per_tenant_tokens.sql — SEC-007: per-tenant SCIM bearer tokens.
--
-- WHY: SCIM provisioning used ONE global bearer token (SCIM_BEARER_TOKEN) for
-- every tenant, with the tenant for each operation taken from the
-- client-supplied x-tenant-id header (falling back to SCIM_TENANT_ID, then a
-- hardcoded default UUID). Anyone holding the one global token could
-- create/read/update/delete users in ANY tenant simply by setting a
-- different header value. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
-- SEC-007 and identity-service/src/modules/scim/routes.ts (pre-fix lines
-- 29-31: `x-tenant-id || SCIM_TENANT_ID || 0000...0001`).
--
-- FIX: scim.scim_tokens binds each bearer token to exactly ONE tenant at
-- issuance time — mirrors apikeys.api_keys (only a SHA-256 hash of the full
-- secret is ever stored, never the plaintext). The SCIM route handlers
-- (see resolveScimTenant in routes.ts) now resolve the tenant SOLELY from
-- the presented bearer token; the x-tenant-id header is no longer part of
-- the trust decision at all — it is only read to log a mismatch.
--
-- NO RLS ON THIS TABLE, DELIBERATELY: identity_svc is NOBYPASSRLS (see
-- migration 0020's comment). A FORCE-RLS `tenant_id = current_tenant_id()`
-- policy requires the correct tenant to ALREADY be set as the app.tenant_id
-- GUC before a query runs — but the whole point of this table's primary
-- access path (find-by-secret-hash, in token-repo.ts) is to DISCOVER the
-- tenant from a credential when no tenant is known yet. Verified empirically
-- against apikeys.api_keys (which DOES carry this same FORCE RLS policy,
-- from migration 0012): a find-by-hash query against it returns ZERO rows
-- whenever the GUC is unset OR set to any tenant other than the row's own —
-- i.e. that policy would make this table's core lookup permanently
-- non-functional for every caller, not merely inconvenient for some. (This
-- also means apikeys.api_keys#findBySecretHash cannot actually resolve a key
-- cross-tenant in production today either, and gateway-service's only
-- caller of that path — POST /internal/apikeys/verify — is not even a
-- route identity-service registers. Flagged separately; out of scope here.)
--
-- Safe without RLS because: (1) secret_hash is a SHA-256 of 32 bytes of
-- CSPRNG entropy — not enumerable or guessable, so reading "the row with
-- this exact hash" requires already possessing that tenant's own live
-- secret, at which point RLS would not have been the thing stopping misuse
-- anyway; (2) every OTHER query against this table (list / get / revoke, in
-- token-repo.ts) explicitly filters by tenant_id in application code — the
-- same belt-and-suspenders style apikeys/repo.ts already layers on top of
-- (here, non-functional) RLS for the exact same table shape.

CREATE SCHEMA IF NOT EXISTS scim;

CREATE TABLE IF NOT EXISTS scim.scim_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  name          VARCHAR(200) NOT NULL,
  -- public, non-secret identifier shown in UIs (e.g. "scim_live_ab12cd").
  token_prefix  VARCHAR(32)  NOT NULL,
  -- SHA-256 hex of the full presented secret. Never the plaintext.
  secret_hash   VARCHAR(64)  NOT NULL,
  status        VARCHAR(24)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  revoked_at    TIMESTAMPTZ,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scim_tokens_prefix      ON scim.scim_tokens (token_prefix);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scim_tokens_secret_hash ON scim.scim_tokens (secret_hash);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_tenant_status     ON scim.scim_tokens (tenant_id, status);
