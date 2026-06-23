-- admin-service api-keys module

CREATE SCHEMA IF NOT EXISTS api_keys;

CREATE TABLE IF NOT EXISTS api_keys.admin_api_keys (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL,
  key_name      text         NOT NULL,
  key_prefix    varchar(16)  NOT NULL,
  key_hash      text         NOT NULL,
  scopes        text[]       NOT NULL DEFAULT '{}',
  status        varchar(24)  NOT NULL DEFAULT 'active',
  last_used_at  timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_admin_api_keys_tenant ON api_keys.admin_api_keys (tenant_id, status);

GRANT USAGE ON SCHEMA api_keys TO admin_svc;
GRANT ALL ON ALL TABLES IN SCHEMA api_keys TO admin_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api_keys TO admin_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA api_keys GRANT ALL ON TABLES TO admin_svc;
