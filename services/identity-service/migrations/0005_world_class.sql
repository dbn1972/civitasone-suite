-- MFA config already exists in mfa.configs, ensure method check constraint
ALTER TABLE mfa.configs DROP CONSTRAINT IF EXISTS configs_method_check;
ALTER TABLE mfa.configs ADD CONSTRAINT configs_method_check CHECK (method IN ('totp','sms','email'));

-- Ensure sessions has is_active column
ALTER TABLE sessions.sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
