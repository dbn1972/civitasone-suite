-- Purpose: add a public, cross-tenant verification directory for shop
-- permits.
--
-- BUG: GET /v1/shop/permits/verify is a deliberately public, unauthenticated
-- route (a citizen scans a QR code / types a verification code printed on
-- the permit -- no login, no tenant known). Two compounding problems:
--
--   1. The route never set `config: { public: true }` on the Fastify route,
--      so @civitasone/auth's authPlugin rejected every unauthenticated
--      caller with a 401 before the handler ever ran -- the "public" route
--      was not actually public.
--   2. Even for an authenticated caller, repo.findByVerificationCode read
--      straight from shop.permits, which has ALTER TABLE ... FORCE ROW
--      LEVEL SECURITY with a tenant_id-equality policy. createTenantTxHook
--      only enters the tenant AsyncLocalStorage from the AUTHENTICATED
--      caller's OWN tenant (app.ts, post PR #999's tenant-header-trust
--      fix) -- a caller verifying an unknown business's permit has no way
--      to supply the permit's actual tenant. The policy predicate
--      `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`
--      then evaluates to NULL for every row not belonging to the caller's
--      own tenant, and Postgres treats NULL as "no match" -- so the public
--      verification feature would silently return 404 for any code except
--      one from the caller's own tenant, for every caller.
--
-- Exact same defect shape as trade-service/migrations/
-- 0002_licence_public_directory.sql (see that file's header for the full
-- story) and this migration mirrors its fix exactly.
--
-- FIX: shop_svc is NOBYPASSRLS by design (see CLAUDE.md's RLS
-- defense-in-depth posture) and owns shop.permits, so `SET row_security =
-- off` does not bypass FORCE RLS for it -- it only turns the silent
-- empty-result into a hard error. The only real bypasses are a BYPASSRLS
-- role (too broad -- every table, every query) or `NO FORCE ROW LEVEL
-- SECURITY` (exempts the owner from RLS on shop.permits ENTIRELY,
-- including the tenant-scoped authenticated routes this table exists to
-- protect -- unacceptable). Instead: a small, NOT RLS-protected directory
-- table carrying ONLY the columns already returned by the verify route's
-- response shape (see src/modules/permits/routes.ts) -- no owner/PII
-- fields (establishment owner, premises address, documents, fee details)
-- are copied here. Kept in sync at the same points that already mutate a
-- permit's public status -- issue (insert), suspend/cancel/restore
-- (repo.updatePermitStatus), and renewal-driven validity extension
-- (repo.updateValidUntil) -- all inside the same DB transaction as the
-- underlying shop.permits write, so the two can never drift.
--
-- Rollback: DROP TABLE IF EXISTS shop.permit_directory;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS shop.permit_directory (
  verification_code   varchar(64) PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  permit_id            uuid NOT NULL,
  permit_number        varchar(64) NOT NULL,
  establishment_name   varchar(256) NOT NULL,
  permit_status        varchar(32) NOT NULL,
  issued_at            timestamptz,
  valid_from           timestamptz,
  valid_until          timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_permit_directory_permit_idx
  ON shop.permit_directory (permit_id);

-- Intentionally NO RLS on this table -- see header. It carries no PII and no
-- owner-identifying data, only already-public permit facts (the same shape
-- the verify route already responds with today).
