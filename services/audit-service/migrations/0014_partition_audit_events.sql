-- 0014_partition_audit_events.sql
-- Purpose: Convert events.events to monthly declarative partitioning on created_at.
--          Audit events are append-only (no UPDATE/DELETE) — ideal for partitioning.
--          Creates partitions for current month + 3 months ahead.
--          Includes a helper function to auto-create future partitions (call monthly via cron).
--
-- Rollback steps:
--   1. Rename partitioned table and restore legacy:
--      ALTER TABLE events.events RENAME TO events_partitioned;
--      ALTER TABLE events.events_legacy RENAME TO events;
--   2. Drop helper function:
--      DROP FUNCTION IF EXISTS events.create_future_partitions();
--
-- NOTE: Audit events are immutable and append-only. This migration moves existing
--       data into the partitioned structure. Schedule during maintenance window.

SET lock_timeout = '5s';

-- Step 1: Rename existing table to legacy (preserve data)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'events' AND table_name = 'events'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'events' AND c.relname = 'events' AND c.relkind = 'p'
  ) THEN
    -- Table exists but is NOT already partitioned — migrate it
    ALTER TABLE events.events RENAME TO events_legacy;
  END IF;
END $$;

-- Step 2: Create partitioned table (only if not already partitioned)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'events' AND c.relname = 'events' AND c.relkind = 'p'
  ) THEN
    EXECUTE '
      CREATE TABLE events.events (
        id             uuid         NOT NULL DEFAULT gen_random_uuid(),
        tenant_id      uuid         NOT NULL,
        type           varchar(128) NOT NULL,
        actor          jsonb        NOT NULL DEFAULT ''{}''::jsonb,
        target         varchar(256),
        payload        jsonb        NOT NULL DEFAULT ''{}''::jsonb,
        severity       varchar(16)  NOT NULL DEFAULT ''info'',
        prev_hash      varchar(64),
        event_hash     varchar(64),
        correlation_id varchar(64),
        occurred_at    timestamptz  NOT NULL DEFAULT now(),
        created_at     timestamptz  NOT NULL DEFAULT now(),
        created_by     uuid         NOT NULL,
        PRIMARY KEY (id, created_at)
      ) PARTITION BY RANGE (created_at)
    ';
  END IF;
END $$;

-- Step 3: Create monthly partitions — current month + 3 months ahead
-- Partition naming: events_yYYYYmMM
DO $$
DECLARE
  start_date date;
  end_date   date;
  part_name  text;
  i          int;
BEGIN
  FOR i IN 0..3 LOOP
    start_date := date_trunc('month', CURRENT_DATE) + (i || ' months')::interval;
    end_date   := start_date + '1 month'::interval;
    part_name  := 'events_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'events' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE events.%I PARTITION OF events.events
         FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    END IF;
  END LOOP;
END $$;

-- Step 4: Create a DEFAULT partition to catch rows outside defined ranges
CREATE TABLE IF NOT EXISTS events.events_default
  PARTITION OF events.events DEFAULT;

-- Step 5: Migrate legacy data into partitioned table (if legacy exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'events' AND table_name = 'events_legacy'
  ) THEN
    INSERT INTO events.events (
      id, tenant_id, type, actor, target, payload, severity,
      prev_hash, event_hash, correlation_id, occurred_at, created_at, created_by
    )
    SELECT
      id, tenant_id, type, actor, target, payload, severity,
      prev_hash, event_hash, correlation_id, occurred_at, created_at, created_by
    FROM events.events_legacy
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Step 6: Recreate indexes on the partitioned table
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_id
  ON events.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type
  ON events.events(type);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON events.events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_occurred
  ON events.events(tenant_id, occurred_at DESC);

-- Step 7: Re-enable RLS on partitioned table
ALTER TABLE events.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events.events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON events.events;
CREATE POLICY tenant_isolation_policy ON events.events
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Step 8: Helper function to auto-create partitions 3 months ahead
-- Call this monthly (e.g., via pg_cron or application scheduler).
CREATE OR REPLACE FUNCTION events.create_future_partitions()
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  start_date date;
  end_date   date;
  part_name  text;
  i          int;
BEGIN
  FOR i IN 0..3 LOOP
    start_date := date_trunc('month', CURRENT_DATE) + (i || ' months')::interval;
    end_date   := start_date + '1 month'::interval;
    part_name  := 'events_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'events' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE events.%I PARTITION OF events.events
         FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    END IF;
  END LOOP;
END $$;

-- Step 9: Drop legacy table after successful migration (guarded)
-- Uncomment after verifying data migrated correctly in production:
-- DROP TABLE IF EXISTS events.events_legacy;
