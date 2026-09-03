-- Purpose: add a public, cross-tenant verification directory for trade licences.
--
-- BUG: GET /v1/trade/licences/verify is a deliberately public, unauthenticated
-- route (a citizen scans a QR code / types a verification code — no login, no
-- tenant known). It read straight from trade.trade_licences, which has
-- ALTER TABLE ... FORCE ROW LEVEL SECURITY with a tenant_id-equality policy.
-- With no app.tenant_id GUC set (createTenantTxHook only sets it from an
-- x-tenant-id header, which a public request never carries, and
-- wrapWithTenantGuc's db.transaction() silently skips the SET when no
-- ambient tenant is present — see packages/db/src/wrap-tenant-db.ts), the
-- policy predicate `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`
-- evaluates to NULL for every row, and Postgres treats NULL as "no match".
-- Confirmed live: `SELECT ... WHERE verification_code = $1` with no GUC set
-- returns 0 rows for an existing, correct code — the public verification
-- feature silently never worked, for any tenant, for any code.
--
-- FIX: the app's connection role (trade_svc) is NOBYPASSRLS by design (see
-- CLAUDE.md's RLS defense-in-depth posture) and is the OWNER of
-- trade_licences, so `SET row_security = off` does not bypass FORCE RLS for
-- it either — it only turns the silent empty-result into a hard error
-- ("query would be affected by row-level security policy"). The only ways to
-- actually bypass FORCE RLS are a BYPASSRLS role (too broad — bypasses RLS
-- on every table for every query on that role) or `NO FORCE ROW LEVEL
-- SECURITY` (exempts the owner from RLS on trade_licences ENTIRELY,
-- including the tenant-scoped authenticated routes this table exists to
-- protect — unacceptable).
--
-- Instead this mirrors the established pattern already in the codebase for
-- exactly this situation — services/court-service/src/modules/public-lookup:
-- a small, NOT RLS-protected directory table that carries ONLY the columns
-- that are meant to be publicly visible. Owner/PII fields (owner_name,
-- premises_address, documents, fee details) are never copied here. The
-- licences module keeps this directory in sync at the same three points
-- that already mutate a licence's public status: issue (insert), suspend/
-- cancel/restore (repo.updateLicenceStatus), and renewal-driven validity
-- extension (repo.updateValidUntil) — all inside the same DB transaction as
-- the underlying trade_licences write, so the two can never drift.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS trade.trade_licence_directory (
  verification_code varchar(64) PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  licence_id         uuid NOT NULL,
  licence_number     varchar(64) NOT NULL,
  trade_category     varchar(64) NOT NULL,
  status             varchar(32) NOT NULL,
  issued_at          timestamptz,
  valid_from         timestamptz,
  valid_until        timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_licence_directory_licence_idx
  ON trade.trade_licence_directory (licence_id);

-- Intentionally NO RLS on this table — see header. It carries no PII and no
-- owner-identifying data, only already-public licence facts.
