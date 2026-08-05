-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0035: CS-001 — Case creation from multiple channels
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Purpose:
--   CS-001 — Add channel, category_id, ticket_no and sla_policy_id columns to
--            helpdesk.tickets; create a counter table for gapless numbering;
--            add uniqueness index on ticket_no; and protect system fields from
--            modification via trigger.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS tickets_protect_system_fields ON helpdesk.tickets;
--   DROP FUNCTION IF EXISTS helpdesk.tickets_protect_system_fields();
--   DROP INDEX CONCURRENTLY IF EXISTS helpdesk.idx_tickets_tenant_ticket_no;
--   DROP TABLE IF EXISTS helpdesk.number_counters;
--   ALTER TABLE helpdesk.tickets DROP COLUMN IF EXISTS sla_policy_id;
--   ALTER TABLE helpdesk.tickets DROP COLUMN IF EXISTS ticket_no;
--   ALTER TABLE helpdesk.tickets DROP COLUMN IF EXISTS category_id;
--   ALTER TABLE helpdesk.tickets DROP COLUMN IF EXISTS channel;
--
-- Affected services: helpdesk-service
-- Sequencing: after 0034_ticket_source_email_inbox.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ─── 1. channel column ──────────────────────────────────────────────────────

ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS channel varchar(24);

-- ─── 2. category_id column (FK to helpdesk.categories) ─────────────────────

ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES helpdesk.categories(id);

-- ─── 3. ticket_no column ────────────────────────────────────────────────────

ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS ticket_no varchar(32);

-- ─── 4. sla_policy_id column ────────────────────────────────────────────────

ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS sla_policy_id uuid;

-- ─── 5. counter table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk.number_counters (
  tenant_id     uuid         NOT NULL,
  format_key    varchar(64)  NOT NULL,
  bucket        varchar(32)  NOT NULL,
  current_value bigint       NOT NULL DEFAULT 0,
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, format_key, bucket)
);

-- RLS on the counter table (guarded to avoid error on rerun)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'helpdesk' AND c.relname = 'number_counters' AND c.relrowsecurity
  ) THEN
    ALTER TABLE helpdesk.number_counters ENABLE ROW LEVEL SECURITY;
    ALTER TABLE helpdesk.number_counters FORCE ROW LEVEL SECURITY;
  END IF;
END$$;

-- RLS policy (guarded via pg_policies check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'helpdesk' AND tablename = 'number_counters'
      AND policyname = 'tenant_isolation_number_counters'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation_number_counters ON helpdesk.number_counters
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)
    $pol$;
  END IF;
END$$;

-- Grant to helpdesk_svc role (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON helpdesk.number_counters TO helpdesk_svc;
  END IF;
END$$;

-- ─── 6. unique index on (tenant_id, ticket_no) where not null ───────────────

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_tenant_ticket_no
  ON helpdesk.tickets (tenant_id, ticket_no) WHERE ticket_no IS NOT NULL;

-- ─── 7. protect system fields trigger ───────────────────────────────────────

CREATE OR REPLACE FUNCTION helpdesk.tickets_protect_system_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- ticket_no: once set, may not be changed or cleared
  IF OLD.ticket_no IS NOT NULL AND (
    NEW.ticket_no IS DISTINCT FROM OLD.ticket_no
  ) THEN
    RAISE EXCEPTION 'cannot modify system field: ticket_no'
      USING ERRCODE = '23514';
  END IF;

  -- created_at: once set, may not be changed or cleared
  IF OLD.created_at IS NOT NULL AND (
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'cannot modify system field: created_at'
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
    WHERE n.nspname = 'helpdesk' AND c.relname = 'tickets'
      AND t.tgname = 'tickets_protect_system_fields'
  ) THEN
    CREATE TRIGGER tickets_protect_system_fields
      BEFORE UPDATE ON helpdesk.tickets
      FOR EACH ROW
      EXECUTE FUNCTION helpdesk.tickets_protect_system_fields();
  END IF;
END$$;
