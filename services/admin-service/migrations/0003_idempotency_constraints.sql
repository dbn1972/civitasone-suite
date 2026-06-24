-- 0003: P0-1 unique constraints backstopping idempotency on mutations.
-- Additive + idempotent (safe to re-run).

-- One feature flag row per (tenant, flag_key). A double-submit of the platform
-- feature-flag create cannot insert a duplicate. (May already exist from an
-- earlier hotfix; IF NOT EXISTS keeps this re-runnable.)
CREATE UNIQUE INDEX IF NOT EXISTS admin_feature_flags_tenant_id_flag_key_key
  ON config.admin_feature_flags (tenant_id, flag_key);

-- At most one in-flight (status='running') backup run per tenant, so a racing
-- double-submit of a backup trigger cannot create two concurrent runs.
CREATE UNIQUE INDEX IF NOT EXISTS admin_backup_runs_one_running_per_tenant
  ON backup.admin_backup_runs (tenant_id)
  WHERE status = 'running';
