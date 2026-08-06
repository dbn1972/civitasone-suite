-- Purpose: Create crm.segment_definitions — the reference customer-segment taxonomy
--          (G5). Today `crm.contacts.segment` is a free-text varchar(64) set by the
--          LQ-003 classification command, so at national scale the column collects
--          spelling variants that cannot be aggregated, and the PRIORITY PRODUCTS /
--          PRIMARY CHANNELS mapping the product spec attaches to each segment — the
--          input to recommendation eligibility and channel selection — was not
--          modelled anywhere.
--
--          This table models it: one row per (tenant, segment_code) carrying the
--          segment's ordered priority products and its primary channels, plus a
--          draft/published/deprecated lifecycle so a taxonomy can be edited before it
--          governs anything.
--
-- Rollback: DROP TABLE IF EXISTS crm.segment_definitions;
--           Nothing else has to be undone. This migration adds a table and touches no
--           existing column, so dropping it returns the service to its previous
--           behaviour exactly (classification enforcement is off by default and is
--           driven by crm.segment_settings from migration 0087, which can be dropped
--           independently).
--
-- Affected services: crm-service (owner). recommendation-service reads the derived
--           eligibility contract over HTTP (GET /v1/crm/segments/{code}/eligibility),
--           never this table directly.
--
-- Sequencing / safety: additive only. No ALTER on an existing table, no column
--           removal, no type change, no backfill, and NO SEED DATA — a deployment's
--           own reference segments are tenant configuration and are loaded as seed
--           data outside platform migrations (see the module README), because
--           hardcoding a particular postal/telecom/etc. taxonomy here would bake
--           tenant-specific logic into the platform.
--
-- Data note: `segment_code` is a stable machine key and is UNIQUE per tenant with no
--           partial predicate, so a soft-deleted code stays reserved. That is
--           deliberate: contacts already classified with it keep their free-text
--           value, and letting the code come back with a different meaning would make
--           historical data lie.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.segment_definitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  -- Stable machine key used as the canonical value of crm.contacts.segment when a
  -- tenant turns catalogue enforcement on. Same 64-char budget as that column, so an
  -- enforceable code can always be stored there.
  segment_code      varchar(64) NOT NULL,
  display_name      varchar(200) NOT NULL,
  description       text,
  -- 'canonical' rows are reference data delivered as seed and are immutable through
  -- the API (422 on update/delete/publish/deprecate regardless of role) so the
  -- platform catalogue cannot silently diverge per tenant. 'tenant' rows are the
  -- deployment's own additions and are fully editable.
  governance        varchar(16) NOT NULL DEFAULT 'tenant'
    CONSTRAINT segment_definitions_governance_check CHECK (governance IN ('canonical', 'tenant')),
  -- ORDERED array of product codes; index 0 is the highest priority. A JSONB array is
  -- used rather than a child table because order is the whole semantic content and
  -- the list is read as one unit by the eligibility endpoint — a child table would
  -- need its own ordinal column and a join for no gain.
  priority_products jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT segment_definitions_priority_products_is_array CHECK (jsonb_typeof(priority_products) = 'array'),
  -- Channel codes from the service's ONE channel vocabulary — the same closed set the
  -- inbound lead-capture route accepts (services/crm-service/src/modules/leads/channels.ts,
  -- persisted on crm.contacts.capture_channel). Enforced here with jsonb array
  -- containment as well as in zod, so a segment can never name a channel no lead can
  -- arrive on. Adding a channel = one line in channels.ts + this list.
  primary_channels  jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT segment_definitions_primary_channels_check CHECK (
      jsonb_typeof(primary_channels) = 'array'
      AND primary_channels <@ '["email","telephony","chatbot","whatsapp","partner_api","campaign"]'::jsonb
    ),
  -- Only 'published' segments are eligible for recommendations and only published
  -- codes are accepted under catalogue enforcement.
  status            varchar(16) NOT NULL DEFAULT 'draft'
    CONSTRAINT segment_definitions_status_check CHECK (status IN ('draft', 'published', 'deprecated')),
  -- Taxonomy revision, bumped on publish. Distinct from `version` below: `version` is
  -- the optimistic-locking counter bumped on every write, `version_number` is the
  -- revision a consumer of the eligibility contract can quote.
  version_number    integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  published_at      timestamptz,
  deprecated_at     timestamptz,
  -- Soft-delete: DELETE never removes the row (steering: never hard-delete user data).
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

-- Re-runnable constraint installation: on a database where an earlier revision of this
-- file already created the table, CREATE TABLE above is a no-op, so the CHECKs would
-- otherwise never appear. `ADD CONSTRAINT IF NOT EXISTS` is not valid PostgreSQL,
-- hence the pg_constraint guards.
SET lock_timeout = '5s';

DO $c1$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'segment_definitions_primary_channels_check'
      AND conrelid = 'crm.segment_definitions'::regclass
  ) THEN
    ALTER TABLE crm.segment_definitions
      ADD CONSTRAINT segment_definitions_primary_channels_check CHECK (
        jsonb_typeof(primary_channels) = 'array'
        AND primary_channels <@ '["email","telephony","chatbot","whatsapp","partner_api","campaign"]'::jsonb
      );
  END IF;
END $c1$;

DO $c2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'segment_definitions_status_check'
      AND conrelid = 'crm.segment_definitions'::regclass
  ) THEN
    ALTER TABLE crm.segment_definitions
      ADD CONSTRAINT segment_definitions_status_check
      CHECK (status IN ('draft', 'published', 'deprecated'));
  END IF;
END $c2$;

-- One definition per code per tenant. This is also what makes the create command
-- replay-safe: the consumer inserts ON CONFLICT (tenant_id, segment_code) DO NOTHING,
-- so a redelivered command converges on the existing row instead of duplicating a
-- segment whose two copies would then disagree about priority.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_segment_definitions_tenant_code
  ON crm.segment_definitions (tenant_id, segment_code);

-- The enforcement hot path: "which codes may crm.contacts.segment hold right now".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segment_definitions_published
  ON crm.segment_definitions (tenant_id, segment_code)
  WHERE status = 'published' AND deleted_at IS NULL;

ALTER TABLE crm.segment_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.segment_definitions FORCE ROW LEVEL SECURITY;

DO $p$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'segment_definitions_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'segment_definitions'
  ) THEN
    CREATE POLICY segment_definitions_tenant_isolation ON crm.segment_definitions
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $p$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.segment_definitions TO crm_svc;
  END IF;
END $g$;
