-- Purpose: add a public, cross-tenant verification directory for fire NOCs.
--
-- BUG (two layers, found while writing the DB-backed test suite for
-- nocs/routes.ts's GET /v1/fire/nocs/verify):
--
--  1. The route was never marked `{ config: { public: true } }`. Every
--     other route in every module of this service correctly calls
--     resolveContext(req)/requireRole(...); this one deliberately does
--     neither, because it's meant to be a public, unauthenticated lookup (a
--     citizen or another department checking a building's fire NOC by its
--     verification code, no login). But @civitasone/auth/plugin's global
--     onRequest hook rejects any request to a non-public route with no
--     valid Bearer token BEFORE the handler ever runs (see
--     packages/auth/src/plugin.ts) -- so this route 401'd for every caller,
--     unconditionally. It was never actually reachable.
--
--  2. Even with (1) fixed, nocs/repo.ts's findByVerificationCode selected
--     straight from fire_nocs.fire_nocs, which has
--     ALTER TABLE ... FORCE ROW LEVEL SECURITY with a tenant_id-equality
--     policy (migrations/0001_initial.sql). A public route has no
--     x-tenant-id header and no verified JWT tenant, so createTenantTxHook
--     (packages/db/src/tenant-tx.ts) never calls tenantStorage.enterWith(...)
--     and no app.tenant_id GUC ever gets set. The policy predicate
--     `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`
--     then evaluates to NULL for every row, and Postgres treats NULL as "no
--     match" -- the query would return 0 rows for every code, forever, even
--     once (1) is fixed.
--
-- This is the exact bug class flagged (for advertisement/shop/building) as
-- unfixed follow-up work in PR #999's description, and already fixed for
-- trade-service in services/trade-service/migrations/
-- 0002_licence_public_directory.sql. fire-service's nocs/verify route has
-- the identical shape and was not covered by either PR. This migration
-- mirrors trade-service's fix exactly.
--
-- FIX: fire_svc is NOBYPASSRLS by design (fleet-wide RLS defense-in-depth
-- posture) and is the OWNER of fire_nocs.fire_nocs, so `SET row_security =
-- off` does not bypass FORCE RLS for it -- it only turns the silent
-- empty-result into a hard error. The only real bypasses are a BYPASSRLS
-- role (too broad -- fleet policy is no service role holds it) or
-- `NO FORCE ROW LEVEL SECURITY` (would exempt the owner from RLS on
-- fire_nocs ENTIRELY, including every tenant-scoped authenticated route --
-- unacceptable). Instead: a small, NOT RLS-protected directory table that
-- carries ONLY the columns meant to be publicly visible. Owner/PII fields
-- (applicant/building details, documents, conditions) are never copied
-- here. The nocs module keeps this directory in sync at the same three
-- points that already mutate a NOC's public status -- issue (insert),
-- suspend (repo.updateStatus -> "suspended"), and revoke
-- (repo.updateStatus -> "revoked") -- all inside the same DB transaction as
-- the underlying fire_nocs write, so the two can never drift.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS fire_nocs.fire_noc_directory (
  verification_code varchar(32) PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  noc_id             uuid NOT NULL,
  noc_number         varchar(64) NOT NULL,
  status             varchar(32) NOT NULL,
  issued_at          timestamptz,
  valid_from         date,
  valid_until        date,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fire_noc_directory_noc_idx
  ON fire_nocs.fire_noc_directory (noc_id);

-- Intentionally NO RLS on this table -- see header. It carries no PII and no
-- applicant-identifying data, only already-public NOC facts, the same set
-- already returned (unscoped) by the pre-fix /verify handler.
