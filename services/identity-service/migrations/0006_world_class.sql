-- Platform: MFA enforcement, session timeout config, API key rotation tracking
ALTER TABLE users.users ADD COLUMN IF NOT EXISTS mfa_enforced BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users.users ADD COLUMN IF NOT EXISTS session_timeout_minutes INT NOT NULL DEFAULT 480;

CREATE TABLE IF NOT EXISTS users.api_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  api_key_id UUID NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_by UUID NOT NULL,
  reason VARCHAR(256)
);
