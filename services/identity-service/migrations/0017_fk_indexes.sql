-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: identity-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- apikeys.api_key_audit.api_key_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_key_audit_api_key_id
  ON apikeys.api_key_audit (api_key_id);

-- apikeys.api_key_audit.actor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_key_audit_actor_id
  ON apikeys.api_key_audit (actor_id);

-- breakglass.grants.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grants_user_id
  ON breakglass.grants (user_id);

-- devices.registered_devices.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registered_devices_user_id
  ON devices.registered_devices (user_id);

-- sync.mailbox_cursors.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mailbox_cursors_user_id
  ON sync.mailbox_cursors (user_id);

-- sync.mailbox_cursors.device_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mailbox_cursors_device_id
  ON sync.mailbox_cursors (device_id);

-- sync.entity_changelog.entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entity_changelog_entity_id
  ON sync.entity_changelog (entity_id);

-- sync.entity_changelog.owner_user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entity_changelog_owner_user_id
  ON sync.entity_changelog (owner_user_id);

-- sync.processed_mutations.device_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processed_mutations_device_id
  ON sync.processed_mutations (device_id);

-- sync.processed_mutations.client_mutation_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processed_mutations_client_mutation_id
  ON sync.processed_mutations (client_mutation_id);

-- sync.processed_mutations.entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processed_mutations_entity_id
  ON sync.processed_mutations (entity_id);

-- rbac.role_permissions.role_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_permissions_role_id
  ON rbac.role_permissions (role_id);

-- rbac.role_permissions.permission_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_permissions_permission_id
  ON rbac.role_permissions (permission_id);

-- rbac.role_assignments.role_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_assignments_role_id
  ON rbac.role_assignments (role_id);

-- rbac.role_assignments.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_assignments_user_id
  ON rbac.role_assignments (user_id);

-- rbac.role_assignment_history.role_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_assignment_history_role_id
  ON rbac.role_assignment_history (role_id);

-- rbac.role_assignment_history.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_assignment_history_user_id
  ON rbac.role_assignment_history (user_id);

-- rbac.role_assignment_history.actor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_assignment_history_actor_id
  ON rbac.role_assignment_history (actor_id);
