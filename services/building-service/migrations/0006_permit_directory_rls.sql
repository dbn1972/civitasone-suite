-- 0006_permit_directory_rls.sql
--
-- V4-C3 (tenant-table-rls-guard): building_permit_directory was created without RLS. It is a public
-- verification directory, but it still carries tenant_id, so it is now ENABLE + FORCE RLS:
--   * tenant_isolation   (ALL)    - writes (and reads) only for the current app.tenant_id, so the
--                                    permits repo's same-transaction directory sync keeps working.
--   * public_verify_read (SELECT) - the anonymous QR-verify route sets the transaction-local GUC
--                                    app.permit_verification_code to the PRESENTED code and nothing
--                                    else; the policy exposes exactly the one row whose
--                                    verification_code equals it. With the GUC unset the predicate is
--                                    false, so the directory cannot be enumerated. Same token-scoped
--                                    pattern as hrms-service 0251 (app.visiting_card_token).
-- Policies are OR-ed (permissive). No INSERT/UPDATE/DELETE bypass is added.
-- 0005_permit_public_directory.sql carries the same statements for fresh databases; this file brings databases
-- that already applied the earlier version up to date. Idempotent.
-- Rollback: DROP POLICY public_verify_read ON building.building_permit_directory; DROP POLICY tenant_isolation ON building.building_permit_directory;
--   ALTER TABLE building.building_permit_directory NO FORCE ROW LEVEL SECURITY; ALTER TABLE building.building_permit_directory DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

ALTER TABLE building.building_permit_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE building.building_permit_directory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON building.building_permit_directory;
CREATE POLICY tenant_isolation ON building.building_permit_directory
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS public_verify_read ON building.building_permit_directory;
CREATE POLICY public_verify_read ON building.building_permit_directory
  FOR SELECT
  USING (verification_code = NULLIF(current_setting('app.permit_verification_code', true), ''));
