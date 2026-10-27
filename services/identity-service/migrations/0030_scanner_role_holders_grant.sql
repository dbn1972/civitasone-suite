-- 0030_scanner_role_holders_grant.sql -- notify-roles.
--
-- GET /identity/internal/role-holders (platform scope) must find the ACTIVE holders of a platform
-- role (platform_admin / super_admin) across ALL tenants, because platform operators are not in the
-- tenant whose event raised a platform notice (a billing/contract/security desk notice). Under the
-- least-privilege identity_svc role (NOBYPASSRLS, FORCE RLS) a cross-tenant SELECT sees zero rows, so
-- the lookup runs on the existing read-only identity_scanner pool (migration 0020) and needs SELECT
-- on exactly the three tables the join touches. Read-only: identity_scanner still cannot write, and
-- the route returns user ids only.

GRANT USAGE ON SCHEMA users TO identity_scanner;
GRANT SELECT ON users.users TO identity_scanner;

GRANT USAGE ON SCHEMA rbac TO identity_scanner;
GRANT SELECT ON rbac.roles TO identity_scanner;
GRANT SELECT ON rbac.role_assignments TO identity_scanner;
