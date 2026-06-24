-- P1-4: scope notification preferences by tenant.
-- The legacy UNIQUE index idx_prefs_user_event (user_id, event_type) collides across
-- tenants, so the same user_id in two tenants cannot hold distinct prefs. Replace it
-- with a tenant-scoped unique index. Additive + idempotent.

-- New tenant-scoped unique index (created first so the old one can be dropped safely).
CREATE UNIQUE INDEX IF NOT EXISTS idx_prefs_tenant_user_event
  ON templates.prefs (tenant_id, user_id, event_type);

-- Drop the cross-tenant unique index now that the scoped one exists.
DROP INDEX IF EXISTS templates.idx_prefs_user_event;
