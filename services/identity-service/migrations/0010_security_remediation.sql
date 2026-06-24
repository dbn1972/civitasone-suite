-- 0010_security_remediation.sql — SECURITY remediation (wave 3). Additive + idempotent.
--
-- H1 (TOTP replay + lockout): mfa.configs gains single-use replay tracking
--   (last_used_step) and per-user verify rate-limit/lockout state
--   (failed_attempts, locked_until).
-- H2 (Keycloak deactivation fail-open): a durable reconciliation table records
--   any Keycloak deactivate that could not be confirmed, so it is retried by the
--   worker reconciler instead of being silently logged-and-dropped.
-- C2 (reserved RBAC keys): mark the system/reserved roles+permissions so the
--   service can refuse to mint/confer them. Existing rows are flagged best-effort.

-- ── H1: TOTP single-use + lockout ──────────────────────────────────────────
ALTER TABLE mfa.configs
  ADD COLUMN IF NOT EXISTS last_used_step  BIGINT,
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ;

-- ── H2: durable Keycloak reconciliation queue (unreconciled deactivations) ──
CREATE TABLE IF NOT EXISTS identity_kc_reconciliations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  user_id        UUID        NOT NULL,
  email          VARCHAR(320) NOT NULL,
  action         VARCHAR(24) NOT NULL,           -- deactivate
  status         VARCHAR(24) NOT NULL DEFAULT 'pending', -- pending | reconciled | failed
  attempts       INTEGER     NOT NULL DEFAULT 0,
  last_error     TEXT,
  severity       VARCHAR(16) NOT NULL DEFAULT 'high',
  correlation_id VARCHAR(64),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kc_recon_pending
  ON identity_kc_reconciliations (status, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kc_recon_open
  ON identity_kc_reconciliations (tenant_id, user_id, action)
  WHERE status = 'pending';

-- ── C2: flag reserved/system RBAC keys already present ──────────────────────
-- Reserved role keys must never be mintable/conferrable by a tenant_admin.
UPDATE rbac.roles
   SET is_system = TRUE
 WHERE key IN ('super_admin','platform_admin','tenant_admin','system','owner')
   AND is_system = FALSE;
