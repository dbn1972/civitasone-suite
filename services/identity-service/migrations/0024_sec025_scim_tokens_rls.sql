-- 0024_sec025_scim_tokens_rls.sql — SEC-025: DB-level backstop for
-- scim.scim_tokens writes.
--
-- WHY: migration 0022 deliberately shipped this table with NO RLS at all,
-- because the primary read path (token-repo.ts#findBySecretHash, used by
-- routes.ts#resolveScimTenant) must discover the tenant from a bearer token
-- BEFORE any tenant is known — a normal FORCE-RLS `tenant_id =
-- current_tenant_id()` policy would make that lookup return zero rows for
-- every caller (see 0022's own comment, empirically verified there against
-- apikeys.api_keys). That reasoning is still correct for SELECT. It was
-- never a reason to leave INSERT/UPDATE/DELETE unprotected too — those
-- write paths (token-repo.ts's insert/touchLastUsed/revoke) have relied
-- solely on application-code tenant_id filtering, with no DB-level backstop
-- if that code ever had a bug. Found during SEC-007's independent review
-- (PR #1227); see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-025.
--
-- FIX: a hybrid policy set, empirically verified feasible by SEC-007's
-- reviewer:
--   - SELECT stays permissive (USING (true)) — unchanged from today's
--     no-RLS behavior, so the tenant-blind hash lookup keeps working, and so
--     does every other SELECT (list/get), which are deliberately still
--     tenant-filtered in application code (token-repo.ts) — the same
--     belt-and-suspenders style apikeys/repo.ts already layers on top of
--     its own (fully tenant-scoped) RLS policy.
--   - INSERT/UPDATE/DELETE are tenant-scoped for the first time: a write
--     naming/touching a row outside app.tenant_id's own bound tenant is now
--     rejected at the DB level even if the calling code had a bug. DELETE
--     is included for defense-in-depth/DoD completeness even though no
--     current code path issues one (revoke is a soft-delete via UPDATE).
--
-- Companion app-code fix (this migration alone is not sufficient — see
-- SEC-010's own lesson that a migration and its call sites must land
-- together): routes.ts's three admin token-management handlers and
-- resolveScimTenant's touchLastUsed call now run their writes inside
-- runWithTenant(...)/db.transaction(...) so the app.tenant_id GUC is
-- actually set when these INSERT/UPDATE statements run — without that, the
-- WITH CHECK below would fail every legitimate write closed, not just
-- cross-tenant ones.

ALTER TABLE scim.scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim.scim_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scim_tokens_select_by_hash ON scim.scim_tokens;
CREATE POLICY scim_tokens_select_by_hash ON scim.scim_tokens
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS scim_tokens_tenant_insert ON scim.scim_tokens;
CREATE POLICY scim_tokens_tenant_insert ON scim.scim_tokens
  FOR INSERT
  WITH CHECK (tenant_id = users.current_tenant_id());

DROP POLICY IF EXISTS scim_tokens_tenant_update ON scim.scim_tokens;
CREATE POLICY scim_tokens_tenant_update ON scim.scim_tokens
  FOR UPDATE
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

DROP POLICY IF EXISTS scim_tokens_tenant_delete ON scim.scim_tokens;
CREATE POLICY scim_tokens_tenant_delete ON scim.scim_tokens
  FOR DELETE
  USING (tenant_id = users.current_tenant_id());
