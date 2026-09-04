-- Purpose: Create the adv_enforcement schema and adv_violations table.
--
-- BUG: src/modules/enforcement/schema.ts has declared advEnforcementSchema
-- (pgSchema("adv_enforcement")) and the advViolations table (adv_violations)
-- since this service was scaffolded, and the entire enforcement module (7
-- routes in enforcement/routes.ts, 5 queue consumers in
-- enforcement/consumer.ts) reads/writes through that Drizzle schema. But
-- migrations/0001_initial.sql only ever created adv_applications,
-- adv_approvals and adv_permits -- adv_enforcement was never created at all.
-- Confirmed directly: grep adv_enforcement migrations/0001_initial.sql finds
-- nothing. On a fresh database (which is what CI now bootstraps per
-- PR #1000), every enforcement route 500s and every enforcement consumer's
-- INSERT/UPDATE fails inside its transaction -- the module has been
-- completely dead since the service was scaffolded, just never observed
-- because nothing applied its migrations until tonight.
--
-- This migration creates exactly what enforcement/schema.ts declares,
-- column-for-column, mirroring the RLS/index/outbox conventions
-- migrations/0001_initial.sql already established for adv_applications/
-- adv_approvals/adv_permits (also cross-checked against
-- services/shop-service/migrations/0001_initial.sql for the same fleet-wide
-- FORCE ROW LEVEL SECURITY + tenant_isolation policy pattern).
--
-- Rollback: DROP SCHEMA adv_enforcement CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMA =====================
CREATE SCHEMA IF NOT EXISTS adv_enforcement;

-- ===================== adv_enforcement.adv_violations =====================
CREATE TABLE IF NOT EXISTS adv_enforcement.adv_violations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  violation_number     varchar(64) NOT NULL UNIQUE,
  permit_id            uuid,
  status               varchar(32) NOT NULL DEFAULT 'reported',
  violation_type       varchar(64) NOT NULL,
  description          text NOT NULL,
  location             jsonb NOT NULL,
  reported_by          uuid NOT NULL,
  reported_at          timestamptz NOT NULL DEFAULT now(),
  notice_issued_at     timestamptz,
  notice_details       jsonb,
  penalty_minor        bigint,
  penalty_currency     varchar(3) DEFAULT 'INR',
  penalty_imposed_at   timestamptz,
  removal_ordered_at   timestamptz,
  removal_deadline     date,
  removal_recorded_at  timestamptz,
  removal_notes        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS adv_violations_tenant_idx ON adv_enforcement.adv_violations (tenant_id);
CREATE INDEX IF NOT EXISTS adv_violations_status_idx ON adv_enforcement.adv_violations (tenant_id, status);
CREATE INDEX IF NOT EXISTS adv_violations_permit_idx ON adv_enforcement.adv_violations (permit_id);

ALTER TABLE adv_enforcement.adv_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_enforcement.adv_violations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adv_violations' AND schemaname = 'adv_enforcement' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON adv_enforcement.adv_violations
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
