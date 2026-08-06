-- Purpose: Create crm.segment_settings — the per-tenant switch that decides whether
--          `crm.contacts.segment` must be a published segment_code from
--          crm.segment_definitions (G5).
--
--          crm-service already stores this kind of per-tenant policy as a one-row
--          table keyed by tenant_id (see crm.deal_close_policy, migration 0061); this
--          follows that mechanism rather than inventing a new one.
--
--          THE DEFAULT IS FALSE, AND A MISSING ROW MEANS FALSE. That is the whole
--          point: `crm.contacts.segment` already holds free text for existing tenants,
--          the column is not being removed, renamed or rewritten, and with the switch
--          off the classification command behaves exactly as it did before this
--          feature existed. Enforcement is opt-in, per tenant, and reversible.
--
-- Rollback: DROP TABLE IF EXISTS crm.segment_settings;
--           Dropping it disables enforcement everywhere (the read path treats a
--           missing row as false), which is the pre-feature behaviour. Safe at any
--           time; no data other than the switch itself is lost.
--
-- Affected services: crm-service only.
--
-- Sequencing / safety: additive only — a new table with no foreign keys, no ALTER of
--           an existing table, no backfill. Deliberately NO backfill: inserting rows
--           for existing tenants would be indistinguishable from an explicit "off"
--           choice, and an absent row already means off.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.segment_settings (
  -- One row per tenant; the primary key is what makes the set-settings command
  -- replay-safe (the consumer upserts ON CONFLICT (tenant_id) DO UPDATE).
  tenant_id                  uuid PRIMARY KEY,
  -- false: accept any free-text segment value (today's behaviour, and the default for
  -- every tenant that has no row here).
  -- true:  the classification command refuses a segment value that is not a published
  --        segment_code for the tenant, with 422 and the valid codes in the message.
  enforce_segment_catalogue  boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NOT NULL,
  version                    integer NOT NULL DEFAULT 1
);

ALTER TABLE crm.segment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.segment_settings FORCE ROW LEVEL SECURITY;

DO $p$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'segment_settings_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'segment_settings'
  ) THEN
    CREATE POLICY segment_settings_tenant_isolation ON crm.segment_settings
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $p$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.segment_settings TO crm_svc;
  END IF;
END $g$;
