-- Purpose: G18 (spec §25.3) — crm.outcome_reason_codes, a GENERIC outcome reason-code
--   catalogue.
--
--   crm.lead_reason_codes (migration 0031, LQ-004) already exists but is scoped to LEAD
--   LIFECYCLE transitions: its `applies_to_status` column names lead statuses
--   (nurture/recycled/disqualified/...), so it cannot describe why an assisted-outreach
--   interaction ended the way it did, nor why a subscription lapsed. This table is the
--   reusable catalogue: `category` says WHICH KIND of interaction a code belongs to and
--   `applies_to` narrows it to particular generic outcome types.
--
--   Vocabulary is deliberately PRODUCT-AGNOSTIC. The platform knows only
--   converted / declined / deferred. Anything domain-specific ("reinvested",
--   "matured", a scheme name) is a tenant's label + code in seed data, never a column
--   and never a CHECK value here.
--
--   Governance follows crm.stage_vocabulary (migration 0079):
--     'canonical' rows are owned by the PLATFORM under the sentinel tenant
--     00000000-0000-0000-0000-000000000000 and are readable by every tenant through
--     the RLS policy below, so national reporting can group on one code. Tenants may
--     not amend them — the route layer refuses, and canonical rows are only ever
--     created by a seed migration.
--     'tenant' rows are owned by the tenant that created them and are freely mutable.
--
--   Versioning: `version_number` is the CATALOGUE revision of a code, and is part of the
--   business key. Retiring a meaning is `active = false`; re-defining one is a new row at
--   version_number + 1. Historic outcomes therefore keep pointing at the exact wording
--   they were captured under, which is what makes a year-on-year comparison honest.
--   (`version` is the ordinary optimistic-lock column, unrelated.)
--
-- Rollback:
--   -- run AFTER 0090's rollback, which drops the FK onto this table:
--   DROP TABLE IF EXISTS crm.outcome_reason_codes;
-- Affected services: crm-service (outcomes module). No other service reads this table;
--   downstream consumers receive the code as a string on crm.interaction_outcome.recorded.
-- Sequencing: additive — new table only. No backfill, no change to existing tables;
--   crm.lead_reason_codes is left exactly as it is.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.outcome_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- Stable machine key a dashboard groups on. Lower snake_case is enforced at the
  -- route boundary (validators.ts) rather than here, so an existing tenant catalogue
  -- imported by a data migration is never rejected mid-flight.
  code varchar(64) NOT NULL,
  label varchar(200) NOT NULL,
  description varchar(1000),
  -- APPLICABILITY DISCRIMINATOR (1 of 2): which kind of record the code describes.
  -- Free-form and bounded rather than a CHECK list: a deployment must be able to add
  -- "field_visit" or "service_request" without a migration.
  category varchar(48) NOT NULL DEFAULT 'interaction',
  -- APPLICABILITY DISCRIMINATOR (2 of 2): the generic outcome types the code may be
  -- used with, e.g. ["declined"]. An EMPTY array means "any outcome type" — that is
  -- the default so a freshly imported catalogue is usable before it is refined.
  applies_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  governance varchar(16) NOT NULL DEFAULT 'tenant'
    CHECK (governance IN ('canonical', 'tenant')),
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  active boolean NOT NULL DEFAULT true,
  ordinal integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_outcome_reason_codes_applies_to CHECK (jsonb_typeof(applies_to) = 'array'),
  -- The business key. `category` is part of it on purpose: the same word means different
  -- things in different contexts ("no_funds" on an outreach call vs on a renewal), and
  -- forcing one global meaning is how a catalogue becomes unusable.
  CONSTRAINT uq_outcome_reason_codes_code UNIQUE (tenant_id, category, code, version_number)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_reason_codes_tenant
  ON crm.outcome_reason_codes (tenant_id, category, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_reason_codes_governance
  ON crm.outcome_reason_codes (governance, code) WHERE deleted_at IS NULL;

ALTER TABLE crm.outcome_reason_codes ENABLE ROW LEVEL SECURITY;

-- Canonical rows are readable by EVERY tenant. Giving each tenant its own copy of a
-- national code list would let the copies drift, which is the problem a canonical
-- catalogue exists to remove.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'outcome_reason_codes_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'outcome_reason_codes'
  ) THEN
    CREATE POLICY outcome_reason_codes_tenant_isolation ON crm.outcome_reason_codes
      USING (
        tenant_id::text = current_setting('app.tenant_id', true)
        OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
      );
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.outcome_reason_codes TO crm_svc;
  END IF;
END $g$;
