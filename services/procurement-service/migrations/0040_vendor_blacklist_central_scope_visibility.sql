-- 0040_vendor_blacklist_central_scope_visibility.sql
-- R17 fix: a federated (CVC/government-wide) vendor debarment was completely
-- defeated by Row-Level Security for every tenant except the one that
-- originally recorded it.
--
-- BUG: migration 0011_central_debarment.sql added `scope`
-- ('tenant' default | 'central') and `pan` to procurement.vendor_blacklist so
-- a central debarment "blocks that PAN across ALL tenants" (its own header
-- comment) -- but it never touched the RLS policy. This table's
-- tenant_isolation_policy (migration 0013_rls_full_tenant_isolation.sql)
-- is `USING (tenant_id = indent.current_tenant_id())` with no exemption for
-- scope='central', and the table is FORCE ROW LEVEL SECURITY. So a
-- scope='central' row is invisible to every session whose app.tenant_id GUC
-- isn't the exact tenant_id that inserted it.
--
-- repo.ts's isCentrallyDebarredTx() / findActiveCentralByPan() /
-- listActiveCentral() are all already written with NO tenant_id filter --
-- correctly, so they'd see a central row platform-wide -- but RLS hides the
-- row from the query before it ever runs, so they silently find nothing for
-- any tenant other than the one that recorded the debarment. Net effect: a
-- central debarment only ever protected the recording tenant; every other
-- tenant could create a vendor with the exact same debarred PAN and be
-- awarded a PO with zero rejection.
--
-- FIX: an ADDITIVE, SELECT-only RLS policy that lets any tenant's session see
-- rows with scope='central', layered on TOP OF (not replacing)
-- tenant_isolation_policy. Postgres ORs together multiple permissive
-- policies for the same command, so SELECT succeeds if EITHER the strict
-- per-tenant match holds OR the row is scope='central'. INSERT/UPDATE/DELETE
-- stay governed SOLELY by tenant_isolation_policy -- unchanged -- so a
-- tenant can still only ever write its own rows; a tenant-scoped
-- (scope='tenant') row from tenant A remains fully invisible to tenant B,
-- exactly as before this migration (this policy's USING clause never
-- matches scope='tenant').
--
-- Mirrors this SAME service's migration 0033
-- (three_way_match_config's platform_default_read_policy) exactly, which
-- uses the identical additive-permissive-policy shape to give every tenant
-- SELECT-only visibility of one specific, narrowly-identified class of
-- cross-tenant row without weakening the strict policy for anything else.
--
-- Verified live: reproduced (central debarment by tenant A invisible to
-- tenant B's own RLS session; a tenant-B vendor with the same PAN cleared
-- the PO-award blacklist gate) against unmodified main, then confirmed
-- fixed after this migration -- see
-- tests/central-debarment.test.ts ("RLS: a central debarment is visible
-- under a DIFFERENT tenant's own session" and "reproduces the reported live
-- bug: ...").
--
-- Rollback: DROP POLICY central_scope_read_policy ON procurement.vendor_blacklist;

SET lock_timeout = '5s';

DROP POLICY IF EXISTS central_scope_read_policy ON procurement.vendor_blacklist;
CREATE POLICY central_scope_read_policy ON procurement.vendor_blacklist
  FOR SELECT
  USING (scope = 'central');
