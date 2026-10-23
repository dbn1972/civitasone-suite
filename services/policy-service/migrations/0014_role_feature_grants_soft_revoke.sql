-- 0014_role_feature_grants_soft_revoke.sql
-- Revoking a role-feature grant used to hard-DELETE the row, so who revoked it,
-- when and why was lost (only an outbox audit event survived), and the reason the
-- UI requires was discarded. Revocation is now a soft delete, and a grant carries
-- the reason it was given. Additive + idempotent.
--
-- Rollback:
--   ALTER TABLE role_features.role_feature_grants
--     DROP COLUMN IF EXISTS reason, DROP COLUMN IF EXISTS revoked_at,
--     DROP COLUMN IF EXISTS revoked_by, DROP COLUMN IF EXISTS revoke_reason;
--   DROP INDEX IF EXISTS role_features.idx_role_feature_grants_active;
ALTER TABLE role_features.role_feature_grants
  ADD COLUMN IF NOT EXISTS reason        text,
  ADD COLUMN IF NOT EXISTS revoked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by    uuid,
  ADD COLUMN IF NOT EXISTS revoke_reason text;
CREATE INDEX IF NOT EXISTS idx_role_feature_grants_active
  ON role_features.role_feature_grants(tenant_id, role_name)
  WHERE revoked_at IS NULL;
