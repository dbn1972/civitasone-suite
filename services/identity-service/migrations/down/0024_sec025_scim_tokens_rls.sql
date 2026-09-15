-- Down-migration for 0024_sec025_scim_tokens_rls.sql — REL-020.
--
-- Reverses SEC-025's DB-level RLS backstop on scim.scim_tokens, returning
-- the table to migration 0022's original state: no row-level security at
-- all (0022's own header explains why — the tenant-blind bearer-token
-- lookup in token-repo.ts#findBySecretHash must run before any tenant is
-- known, so SELECT was deliberately left unprotected; 0024 added
-- FORCE ROW LEVEL SECURITY and four named policies on top of that).
--
-- Run via scripts/ops/migrate-rollback.sh, never by hand: that tool wraps
-- this file in a single transaction (psql -1 -v ON_ERROR_STOP=1), so if
-- 0024 was never actually applied (the DROP POLICY IF EXISTS/ALTER TABLE
-- statements below would simply no-op on an already-bare table) this is
-- harmless either way.
--
-- CAUTION for a real production rollback (not applicable to the disposable
-- verification cluster this was tested against): this removes the DB-level
-- backstop on INSERT/UPDATE/DELETE for scim.scim_tokens, reverting to
-- relying solely on application-code tenant_id filtering in token-repo.ts
-- for those writes (SEC-025's whole point was that this backstop should
-- exist). Confirm this is genuinely intended — e.g. migration 0024 itself
-- is the one causing an incident — before rolling it back, not as a
-- routine rollback target.
--
-- See scripts/ops/MIGRATION-ROLLBACK.md for the full procedure.

SET lock_timeout = '5s';

DROP POLICY IF EXISTS scim_tokens_tenant_delete ON scim.scim_tokens;
DROP POLICY IF EXISTS scim_tokens_tenant_update ON scim.scim_tokens;
DROP POLICY IF EXISTS scim_tokens_tenant_insert ON scim.scim_tokens;
DROP POLICY IF EXISTS scim_tokens_select_by_hash ON scim.scim_tokens;

ALTER TABLE scim.scim_tokens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE scim.scim_tokens DISABLE ROW LEVEL SECURITY;
