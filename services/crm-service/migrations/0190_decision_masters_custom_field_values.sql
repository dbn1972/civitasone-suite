-- Purpose: owner-approved CRM decision sheet (2026-11-26), items C5 / C6 / C10.
--   C5  GAP-CRM-PRICE-BOOKS-02          tenant-managed masters for price-book SEGMENT and CHANNEL
--       (geography comes from the existing India state/UT master, no table).
--   C6  GAP-CRM-QUALIFICATION-FRAMEWORKS-04  tenant-configured BUSINESS-LINE master, plus a
--       nullable business_line attribute on crm.contacts (a lead is a contact row) so a
--       framework can be matched to the lead it applies to.
--   C10 GAP-CRM-CUSTOM-FIELDS-01        custom_field_values: the value store for the existing
--       crm.custom_fields definitions (a table, not a jsonb column on contacts).
-- All three masters mirror crm.grievance_categories (code + label + active + sort_order, RLS
-- forced, crm_svc grants) and are created EMPTY: no fake tenant rows are inserted. While a
-- tenant's master is empty the matching API field stays an open vocabulary (see
-- shared/master-values.ts), so existing price books / frameworks keep working until the tenant
-- configures its list.
-- Rollback:
--   DROP TABLE IF EXISTS crm.custom_field_values;
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS business_line;
--   DROP TABLE IF EXISTS crm.business_lines, crm.price_book_channels, crm.price_book_segments;
-- Affected services: crm-service (price-books, leads/qualification, contacts, custom-fields)
-- Sequencing: additive only (3 new tables, 1 nullable column, 1 new table); idempotent; no backfill.
--   Deploy the migration BEFORE the new crm-service.

SET lock_timeout = '5s';

-- ── Code masters ────────────────────────────────────────────────────────────
DO $m$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['price_book_segments', 'price_book_channels', 'business_lines'] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS crm.%1$I (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL,
        code        varchar(64) NOT NULL,
        label       varchar(160) NOT NULL,
        active      boolean NOT NULL DEFAULT true,
        sort_order  integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        created_by  uuid NOT NULL,
        updated_by  uuid NOT NULL,
        version     integer NOT NULL DEFAULT 1,
        CONSTRAINT %2$I UNIQUE (tenant_id, code)
      )$f$, t, 'uq_' || t || '_code');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON crm.%I (tenant_id) WHERE active = true', 'idx_' || t || '_tenant', t);
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'crm' AND tablename = t AND policyname = t || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON crm.%I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
        t || '_tenant_isolation', t);
    END IF;
  END LOOP;
END $m$;

-- ── Lead business line (a lead is a crm.contacts row) ───────────────────────
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS business_line varchar(64);

-- ── Custom-field values (C10) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm.custom_field_values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  field_id    uuid NOT NULL REFERENCES crm.custom_fields(id) ON DELETE CASCADE,
  entity_type varchar(24) NOT NULL,
  entity_id   uuid NOT NULL,
  value       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_custom_field_values_field_entity UNIQUE (tenant_id, field_id, entity_id)
);

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_field_values_entity_type_check') THEN
    ALTER TABLE crm.custom_field_values
      ADD CONSTRAINT custom_field_values_entity_type_check CHECK (entity_type IN ('leads', 'contacts', 'deals'));
  END IF;
END $c$;

CREATE INDEX IF NOT EXISTS idx_custom_field_values_entity
  ON crm.custom_field_values (tenant_id, entity_type, entity_id);

ALTER TABLE crm.custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.custom_field_values FORCE ROW LEVEL SECURITY;

DO $p$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'crm' AND tablename = 'custom_field_values'
      AND policyname = 'custom_field_values_tenant_isolation'
  ) THEN
    CREATE POLICY custom_field_values_tenant_isolation ON crm.custom_field_values
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $p$;

-- ── Grants ──────────────────────────────────────────────────────────────────
DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      crm.price_book_segments, crm.price_book_channels, crm.business_lines, crm.custom_field_values
      TO crm_svc;
  END IF;
END $g$;
