-- Migration 0016: GAP2-GRANTS-GRANTEES-07 — a real, stable grantee registration
-- code column (replacing the UUID-fragment "code" the API used to derive on the
-- fly: row.id.slice(0,8).toUpperCase(), which was unstable, collision-prone and
-- leaked internal id bytes as a user-facing identifier).
--
-- Adds:
--   * beneficiary.grant_beneficiaries.grantee_code  — nullable, unique per tenant.
--   * beneficiary.grant_beneficiary_counters        — gapless per-tenant sequence
--     allocator (same pattern as application.grant_sanction_counters) used by the
--     beneficiaryCreate consumer to assign GR-<nnnnn> on registration.
-- Backfills existing rows deterministically by created_at order so every current
-- grantee gets a stable code immediately (no row is left showing a UUID fragment).
--
-- Additive and idempotent. Safe to re-run.
-- Rollback:
--   ALTER TABLE beneficiary.grant_beneficiaries DROP COLUMN IF EXISTS grantee_code;
--   DROP TABLE IF EXISTS beneficiary.grant_beneficiary_counters;
-- Run as: grant_svc on civitas_grant
-- Affected services: grant-service (beneficiary module)

SET lock_timeout = '5s';

ALTER TABLE beneficiary.grant_beneficiaries
  ADD COLUMN IF NOT EXISTS grantee_code text;

-- Per-tenant gapless counter for grantee codes (mirrors grant_sanction_counters).
CREATE TABLE IF NOT EXISTS beneficiary.grant_beneficiary_counters (
  tenant_id uuid   NOT NULL,
  next_val  bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id)
);

ALTER TABLE beneficiary.grant_beneficiary_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_beneficiary_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON beneficiary.grant_beneficiary_counters;
CREATE POLICY tenant_isolation_policy ON beneficiary.grant_beneficiary_counters
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- Backfill existing grantees with a stable code, numbered per tenant by
-- registration order. Idempotent: only touches rows that have no code yet.
-- Both tables are FORCE RLS and this runs outside any tenant GUC, so the table
-- owner would see/modify zero rows. Lift FORCE for the backfill only, then restore.
ALTER TABLE beneficiary.grant_beneficiaries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_beneficiary_counters NO FORCE ROW LEVEL SECURITY;

WITH numbered AS (
  SELECT id,
         tenant_id,
         row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM beneficiary.grant_beneficiaries
  WHERE grantee_code IS NULL
)
UPDATE beneficiary.grant_beneficiaries b
SET grantee_code = 'GR-' || lpad(numbered.rn::text, 5, '0')
FROM numbered
WHERE b.id = numbered.id;

-- Seed each tenant's counter past the highest backfilled number so the consumer
-- never re-issues a backfilled code. Idempotent (ON CONFLICT keeps the max).
INSERT INTO beneficiary.grant_beneficiary_counters (tenant_id, next_val)
SELECT tenant_id, COUNT(*) + 1
FROM beneficiary.grant_beneficiaries
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE
  SET next_val = GREATEST(beneficiary.grant_beneficiary_counters.next_val, EXCLUDED.next_val);

ALTER TABLE beneficiary.grant_beneficiaries FORCE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_beneficiary_counters FORCE ROW LEVEL SECURITY;

-- Unique per tenant (a code is only meaningful within its tenant).
CREATE UNIQUE INDEX IF NOT EXISTS uq_grant_beneficiaries_tenant_code
  ON beneficiary.grant_beneficiaries (tenant_id, grantee_code);

-- When this migration is applied by a superuser rather than the service role,
-- the new counter table is owned by that superuser and grant_svc has no
-- privileges — the running service (which connects as grant_svc) could then
-- neither read nor write it. Transfer ownership to grant_svc and grant the
-- standard CRUD set so it behaves identically to a service-role-created table.
-- Idempotent and a no-op when grant_svc already owns it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grant_svc') THEN
    EXECUTE 'ALTER TABLE beneficiary.grant_beneficiary_counters OWNER TO grant_svc';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON beneficiary.grant_beneficiary_counters TO grant_svc';
  END IF;
END
$$;
