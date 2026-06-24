-- 0006 (P0-1, DPDP): app-layer AES-256-GCM PII encryption at rest for
-- portal.citizen_profiles (email / mobile / digilocker_token / address).
--
-- The ciphertext envelope ("enc:v2:<keyid>:<base64>") is longer than the legacy
-- mobile varchar(16), so widen mobile to text. email/digilocker_token/address
-- are already text. Idempotent + additive; legacy plaintext rows are passed
-- through transparently by the app decrypt layer until re-written.
ALTER TABLE portal.citizen_profiles
  ALTER COLUMN mobile TYPE text;

-- 0006b (P1-1): persist SLA escalation rules (previously an in-memory store in
-- sla-rules/routes.ts). Survives restart and feeds the SLA sweep.
CREATE TABLE IF NOT EXISTS citizen.sla_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  priority         VARCHAR(16) NOT NULL,
  escalation_hours INT NOT NULL,
  escalate_to      VARCHAR(64) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, priority)
);
CREATE INDEX IF NOT EXISTS idx_sla_rules_tenant ON citizen.sla_rules(tenant_id, is_active);
