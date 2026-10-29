-- 0033_users_keycloak_user_id.sql
-- Purpose (FQ14): every service sees a login as its JWT `sub`, which is the KEYCLOAK user id.
--   identity-service mints its own random users.users.id and provisions a separate Keycloak user
--   (shared/keycloak.ts provisionUser), keeping the link only as the Keycloak attribute
--   identity_user_id. So /identity/internal/users/:id/email|status, keyed by a sub, always 404'd and
--   no login could be linked to its HRMS employee record. This column stores the Keycloak user id on
--   the identity row so those internal lookups can resolve a sub without a Keycloak round-trip.
-- Set by: the createUser consumer after provisioning, POST /identity/users/:id/keycloak-reconcile,
--   and the one-off backfill (src/scripts/backfill-keycloak-user-ids.ts) for existing users.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS. Nullable, no default,
--   so the ALTER is metadata-only (no table rewrite).
-- Unique: one Keycloak user maps to at most one identity user (Keycloak ids are realm-unique and the
--   realm user is tenant-namespaced, see keycloak.ts kcUsername). Lookups stay tenant-scoped in code
--   (tenant_id = ctx.tenantId AND keycloak_user_id = $sub) and under the table's existing RLS.
-- Rollback: migrations/down/0033_users_keycloak_user_id.sql
-- Affected services: identity-service

SET lock_timeout = '5s';

ALTER TABLE users.users ADD COLUMN IF NOT EXISTS keycloak_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS users_keycloak_user_id_uq
  ON users.users (keycloak_user_id)
  WHERE keycloak_user_id IS NOT NULL;
