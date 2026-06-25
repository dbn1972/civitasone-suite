-- 0011_api_keys_break_glass.sql — wave 4 domain completeness. Additive + idempotent.
--
-- Two missing identity domains the platform needs end-to-end:
--
--   apikeys.api_keys       — tenant-scoped service/API credentials. Only a
--                            SHA-256 hash of the secret is stored (never the
--                            plaintext). Scopes are an explicit allow-list
--                            enforced on every call. Lifecycle:
--                            active → rotated | revoked. Rotation issues a NEW
--                            secret for the SAME key id and bumps key_version,
--                            invalidating the prior secret immediately.
--   apikeys.api_key_audit  — append-only audit of issue/rotate/revoke/denied.
--
--   breakglass.grants      — emergency elevated-access grants. Time-boxed (TTL);
--                            exactly ONE running grant per (tenant,user) enforced
--                            by a partial unique index. Lifecycle:
--                            active → closed | expired. Closing is idempotent.
--
-- All tenant-scoped, optimistic-locked via version, audited via the outbox.

-- ── API keys ────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS apikeys;

CREATE TABLE IF NOT EXISTS apikeys.api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  name          VARCHAR(200) NOT NULL,
  -- public, non-secret identifier shown in UIs / sent as a prefix (e.g. "ak_live_ab12cd").
  key_prefix    VARCHAR(32)  NOT NULL,
  -- SHA-256 hex of the full secret. Never the plaintext.
  secret_hash   VARCHAR(64)  NOT NULL,
  -- explicit allow-list of scope strings (e.g. "users:read", "rbac:write").
  scopes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        VARCHAR(24) NOT NULL DEFAULT 'active',   -- active | rotated | revoked
  key_version   INTEGER NOT NULL DEFAULT 1,
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  revoked_at    TIMESTAMPTZ,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_prefix      ON apikeys.api_keys (key_prefix);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_secret_hash ON apikeys.api_keys (secret_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_status     ON apikeys.api_keys (tenant_id, status);

CREATE TABLE IF NOT EXISTS apikeys.api_key_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  api_key_id   UUID NOT NULL,
  action       VARCHAR(24) NOT NULL,        -- issue | rotate | revoke | denied
  actor_id     UUID NOT NULL,
  detail       VARCHAR(500),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_key_audit_key ON apikeys.api_key_audit (tenant_id, api_key_id, recorded_at);

-- ── Break-glass emergency grants ────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS breakglass;

CREATE TABLE IF NOT EXISTS breakglass.grants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  reason       VARCHAR(500) NOT NULL,
  scope        VARCHAR(128) NOT NULL,        -- the elevated capability granted
  status       VARCHAR(24)  NOT NULL DEFAULT 'active',  -- active | closed | expired
  granted_by   UUID NOT NULL,
  closed_by    UUID,
  close_reason VARCHAR(500),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  closed_at    TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  version      INTEGER NOT NULL DEFAULT 1
);
-- Exactly ONE running (active) break-glass grant per (tenant,user). The partial
-- unique index makes a concurrent second open fail at the DB, not just in app.
CREATE UNIQUE INDEX IF NOT EXISTS uq_breakglass_one_active
  ON breakglass.grants (tenant_id, user_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_breakglass_active_expiry
  ON breakglass.grants (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_breakglass_tenant
  ON breakglass.grants (tenant_id, status, granted_at);
