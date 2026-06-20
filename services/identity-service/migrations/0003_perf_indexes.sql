-- identity-service performance indexes (0003)

CREATE INDEX IF NOT EXISTS idx_registered_devices_tenant_user
  ON devices.registered_devices (tenant_id, user_id);
