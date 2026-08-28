-- roles.permissions had no unique constraint (unlike roles.roles, protected by
-- idx_roles_tenant_name in 0001_init.sql), so a retried/duplicate addPermission
-- command — e.g. a seed script re-POSTing after a stale-read false negative on
-- the async command-queue write path — silently inserts a duplicate grant row.
-- Harmless for the authorization decision itself (evaluateDecision matches on
-- first hit) but a data-quality gap. Mirrors idx_roles_tenant_name's protection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_tenant_role_resource_action
  ON roles.permissions(tenant_id, role_id, resource, action);
