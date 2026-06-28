-- 0019: Device Trust & Compliance
-- Lightweight device inventory + compliance checks + remote revoke
-- NOT MDM — app-level visibility for admins

CREATE TABLE IF NOT EXISTS hrms.trusted_devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  device_id TEXT NOT NULL, -- unique device identifier
  -- Device info (reported by app at login/sync)
  device_name TEXT NOT NULL DEFAULT '', -- e.g. "Samsung Galaxy S24", "iPhone 15 Pro"
  platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('android', 'ios', 'web', 'unknown')),
  os_version TEXT NOT NULL DEFAULT '', -- e.g. "Android 14", "iOS 17.4"
  app_version TEXT NOT NULL DEFAULT '', -- e.g. "0.1.0+1"
  -- Security posture
  is_rooted BOOLEAN NOT NULL DEFAULT false, -- jailbroken/rooted detection
  has_screen_lock BOOLEAN NOT NULL DEFAULT true, -- passcode/biometric enabled
  is_encrypted BOOLEAN NOT NULL DEFAULT true, -- device encryption status
  biometric_available BOOLEAN NOT NULL DEFAULT false,
  -- Trust status
  trust_status TEXT NOT NULL DEFAULT 'trusted' CHECK (trust_status IN ('trusted', 'flagged', 'blocked')),
  flagged_reason TEXT, -- why it was flagged (e.g. "rooted", "no_screen_lock", "outdated_os")
  blocked_by UUID,
  blocked_at TIMESTAMPTZ,
  blocked_reason TEXT,
  -- Activity
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ip TEXT,
  last_location TEXT, -- city/region if available
  login_count INT NOT NULL DEFAULT 1,
  -- Lifecycle
  UNIQUE (tenant_id, user_id, device_id)
);

CREATE INDEX idx_trusted_devices_tenant ON hrms.trusted_devices (tenant_id, trust_status);
CREATE INDEX idx_trusted_devices_user ON hrms.trusted_devices (tenant_id, user_id);

-- Device activity log — tracks key security events per device
CREATE TABLE IF NOT EXISTS hrms.device_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- login, sync, token_refresh, logout, revoked, compliance_check
  metadata JSONB NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_activity_tenant ON hrms.device_activity_log (tenant_id, created_at DESC);
CREATE INDEX idx_device_activity_device ON hrms.device_activity_log (device_id, created_at DESC);

-- Compliance policies (configurable per tenant)
CREATE TABLE IF NOT EXISTS hrms.device_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  min_os_version_android TEXT NOT NULL DEFAULT '12', -- minimum Android version
  min_os_version_ios TEXT NOT NULL DEFAULT '16', -- minimum iOS version
  min_app_version TEXT NOT NULL DEFAULT '0.1.0', -- minimum app version
  block_rooted BOOLEAN NOT NULL DEFAULT true, -- auto-block rooted devices
  require_screen_lock BOOLEAN NOT NULL DEFAULT true, -- flag if no passcode
  require_biometric BOOLEAN NOT NULL DEFAULT false, -- require biometric capable
  max_inactive_days INT NOT NULL DEFAULT 90, -- auto-flag after N days inactive
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);
