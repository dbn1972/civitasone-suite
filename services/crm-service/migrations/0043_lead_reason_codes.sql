-- Purpose: LQ-004 — per-tenant catalog of lifecycle transition reason codes and a
--          reason_code column on the audit trail. Transitions to configured
--          statuses (nurture/recycled/disqualified, and re-open) now require a
--          reason code drawn from this catalog instead of only free-text.
-- Rollback: ALTER TABLE crm.lead_transitions DROP COLUMN IF EXISTS reason_code;
--           DROP TABLE IF EXISTS crm.lead_reason_codes;
-- Affected services: crm-service
-- Sequencing: additive — new tenant-scoped table + one nullable column on
--             crm.lead_transitions. Codes are seeded lazily per tenant on first
--             read (ON CONFLICT DO NOTHING), so no backfill.

SET lock_timeout = '5s';

-- reason column on lead_transitions is NOT NULL from 0018; keep free-text reason as
-- an optional note by adding the code alongside it (existing rows keep reason='').
ALTER TABLE crm.lead_transitions
  ADD COLUMN IF NOT EXISTS reason_code varchar(48);

CREATE TABLE IF NOT EXISTS crm.lead_reason_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  code             varchar(48) NOT NULL,
  label            varchar(160) NOT NULL,
  -- Which target status this code is valid for (nurture | recycled | disqualified |
  -- new | qualified). A code is only accepted on a transition to this status.
  applies_to_status varchar(24) NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

-- One code per (tenant, status, code): PUT upserts against this index and lazy
-- seeding inserts ON CONFLICT DO NOTHING, so a race cannot double-seed.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_lead_reason_codes_tenant_status_code
  ON crm.lead_reason_codes (tenant_id, applies_to_status, code);

ALTER TABLE crm.lead_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_reason_codes FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm'
      AND tablename='lead_reason_codes' AND policyname='lead_reason_codes_tenant_isolation') THEN
    CREATE POLICY lead_reason_codes_tenant_isolation ON crm.lead_reason_codes
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_reason_codes TO crm_svc;
  END IF;
END $g$;
