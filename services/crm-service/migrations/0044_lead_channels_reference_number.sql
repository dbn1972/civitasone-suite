-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0044: Lead channels + unique reference number
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   LM-005 — Add capture_channel and capture_metadata to crm.contacts so the
--            inbound consumer persists the channel/metadata of every captured lead.
--   LM-006 — Add lead_no (unique per tenant, gapless reference), a counter table
--            (crm.number_counters), a uniqueness index, and a system-field
--            protection trigger.
--
-- Rollback:
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS capture_channel;
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS capture_metadata;
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS lead_no;
--   DROP INDEX CONCURRENTLY IF EXISTS crm.idx_contacts_tenant_lead_no;
--   DROP TRIGGER IF EXISTS contacts_protect_system_fields ON crm.contacts;
--   DROP FUNCTION IF EXISTS crm.contacts_protect_system_fields();
--   DROP TABLE IF EXISTS crm.number_counters;
--
-- Affected services: crm-service
-- Sequencing: after 0043_lead_reason_codes.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ─── LM-005: capture_channel + capture_metadata on crm.contacts ─────────────

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS capture_channel varchar(24);

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS capture_metadata jsonb;

-- ─── LM-006: lead_no column ─────────────────────────────────────────────────

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS lead_no varchar(32);

-- ─── LM-006: counter table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm.number_counters (
  tenant_id    uuid         NOT NULL,
  format_key   varchar(64)  NOT NULL,
  bucket       varchar(32)  NOT NULL,
  current_value bigint      NOT NULL DEFAULT 0,
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, format_key, bucket)
);

-- RLS on the counter table (guarded to avoid error on rerun)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'crm' AND c.relname = 'number_counters' AND c.relrowsecurity
  ) THEN
    ALTER TABLE crm.number_counters ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm.number_counters FORCE ROW LEVEL SECURITY;
  END IF;
END$$;

-- RLS policy (guarded via pg_policies check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'crm' AND tablename = 'number_counters'
      AND policyname = 'tenant_isolation_number_counters'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation_number_counters ON crm.number_counters
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)
    $pol$;
  END IF;
END$$;

-- Grant to crm_svc role (idempotent)
GRANT SELECT, INSERT, UPDATE ON crm.number_counters TO crm_svc;

-- ─── LM-006: unique index on (tenant_id, lead_no) where not null ────────────

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_lead_no
  ON crm.contacts (tenant_id, lead_no) WHERE lead_no IS NOT NULL;

-- ─── LM-006: protect system fields trigger ──────────────────────────────────

CREATE OR REPLACE FUNCTION crm.contacts_protect_system_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- lead_no: once set, may not be changed or cleared
  IF OLD.lead_no IS NOT NULL AND (
    NEW.lead_no IS DISTINCT FROM OLD.lead_no
  ) THEN
    RAISE EXCEPTION 'cannot modify system field: lead_no'
      USING ERRCODE = '23514';
  END IF;

  -- created_at: once set, may not be changed or cleared
  IF OLD.created_at IS NOT NULL AND (
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'cannot modify system field: created_at'
      USING ERRCODE = '23514';
  END IF;

  -- created_by: once set, may not be changed or cleared
  IF OLD.created_by IS NOT NULL AND (
    NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'cannot modify system field: created_by'
      USING ERRCODE = '23514';
  END IF;

  -- capture_form_id: once set, may not be changed or cleared
  IF OLD.capture_form_id IS NOT NULL AND (
    NEW.capture_form_id IS DISTINCT FROM OLD.capture_form_id
  ) THEN
    RAISE EXCEPTION 'cannot modify system field: capture_form_id'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END$$;

-- Guard CREATE TRIGGER on pg_trigger (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'crm' AND c.relname = 'contacts'
      AND t.tgname = 'contacts_protect_system_fields'
  ) THEN
    CREATE TRIGGER contacts_protect_system_fields
      BEFORE UPDATE ON crm.contacts
      FOR EACH ROW
      EXECUTE FUNCTION crm.contacts_protect_system_fields();
  END IF;
END$$;
