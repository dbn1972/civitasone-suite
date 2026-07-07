-- 0007_partition_fact_events.sql
-- Purpose: Convert analytics.fact_events to monthly declarative partitioning on ingested_at.
--          Creates partitions for current month + 3 months ahead.
--          Includes a helper function to auto-create future partitions (call monthly via cron).
--
-- Rollback steps:
--   1. Rename analytics.fact_events back and drop partitioned table:
--      ALTER TABLE analytics.fact_events RENAME TO fact_events_partitioned;
--      ALTER TABLE analytics.fact_events_legacy RENAME TO fact_events;
--   2. Drop helper function:
--      DROP FUNCTION IF EXISTS analytics.create_future_partitions();
--
-- NOTE: This migration moves existing data. On large tables this may take time.
--       Schedule during a maintenance window for production deployments.

SET lock_timeout = '5s';

-- Step 1: Rename existing table to legacy (preserve data)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'analytics' AND table_name = 'fact_events'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'analytics' AND c.relname = 'fact_events' AND c.relkind = 'p'
  ) THEN
    -- Table exists but is NOT already partitioned — migrate it
    ALTER TABLE analytics.fact_events RENAME TO fact_events_legacy;
  END IF;
END $$;

-- Step 2: Create partitioned table (only if not already partitioned)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'analytics' AND c.relname = 'fact_events' AND c.relkind = 'p'
  ) THEN
    EXECUTE '
      CREATE TABLE analytics.fact_events (
        id          uuid         NOT NULL DEFAULT gen_random_uuid(),
        tenant_id   uuid         NOT NULL,
        source      varchar(32)  NOT NULL,
        event_type  varchar(64)  NOT NULL,
        category    varchar(64)  NOT NULL DEFAULT ''general'',
        status      varchar(32)  NOT NULL DEFAULT ''unknown'',
        amount      bigint       NOT NULL DEFAULT 0,
        occurred_at timestamptz  NOT NULL DEFAULT now(),
        dedupe_key  varchar(128) NOT NULL,
        version     integer      NOT NULL DEFAULT 1,
        created_by  uuid         NOT NULL,
        updated_by  uuid         NOT NULL,
        ingested_at timestamptz  NOT NULL DEFAULT now(),
        PRIMARY KEY (id, ingested_at)
      ) PARTITION BY RANGE (ingested_at)
    ';
  END IF;
END $$;

-- Step 3: Create monthly partitions — current month + 3 months ahead
-- Partition naming: fact_events_yYYYYmMM
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
    part_name  := 'fact_events_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'analytics' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE analytics.%I PARTITION OF analytics.fact_events
         FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    END IF;
  END LOOP;
END $$;

-- Step 4: Create a DEFAULT partition to catch rows outside defined ranges
CREATE TABLE IF NOT EXISTS analytics.fact_events_default
  PARTITION OF analytics.fact_events DEFAULT;

-- Step 5: Migrate legacy data into partitioned table (if legacy exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'analytics' AND table_name = 'fact_events_legacy'
  ) THEN
    INSERT INTO analytics.fact_events (
      id, tenant_id, source, event_type, category, status,
      amount, occurred_at, dedupe_key, version, created_by, updated_by, ingested_at
    )
    SELECT
      id, tenant_id, source, event_type, category, status,
      amount, occurred_at, dedupe_key, version, created_by, updated_by, ingested_at
    FROM analytics.fact_events_legacy
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Step 6: Recreate indexes on the partitioned table
CREATE UNIQUE INDEX IF NOT EXISTS uq_fact_dedupe
  ON analytics.fact_events(tenant_id, dedupe_key, ingested_at);
CREATE INDEX IF NOT EXISTS idx_fact_tenant_time
  ON analytics.fact_events(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_fact_tenant_source
  ON analytics.fact_events(tenant_id, source);

-- Step 7: Re-enable RLS on partitioned table
ALTER TABLE analytics.fact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.fact_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.fact_events;
CREATE POLICY tenant_isolation_policy ON analytics.fact_events
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Step 8: Helper function to auto-create partitions 3 months ahead
-- Call this monthly (e.g., via pg_cron or application scheduler).
CREATE OR REPLACE FUNCTION analytics.create_future_partitions()
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
    part_name  := 'fact_events_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'analytics' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE analytics.%I PARTITION OF analytics.fact_events
         FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    END IF;
  END LOOP;
END $$;

-- Step 9: Drop legacy table after successful migration (guarded)
-- Uncomment after verifying data migrated correctly in production:
-- DROP TABLE IF EXISTS analytics.fact_events_legacy;
