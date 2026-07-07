-- 0009_partition_outbox.sql
-- Purpose: Convert _outbox.messages to monthly declarative partitioning on created_at.
--          Grant-service outbox carries scheme application lifecycle events.
--          Partitioning allows DROP PARTITION for fast purge and reduces index bloat
--          on this high-volume, append-only table.
--          Creates partitions for current month + 3 months ahead.
--          Includes a helper function to auto-create future partitions (call monthly via cron).
--
-- Rollback steps:
--   1. Rename partitioned table and restore legacy:
--      ALTER TABLE _outbox.messages RENAME TO messages_partitioned;
--      ALTER TABLE _outbox.messages_legacy RENAME TO messages;
--   2. Drop helper function:
--      DROP FUNCTION IF EXISTS _outbox.create_future_partitions();
--
-- NOTE: This migration moves existing data. On large deployments, schedule during
--       a maintenance window. The outbox is transient (7-day retention) so data
--       volume should be manageable.

SET lock_timeout = '5s';

-- Step 1: Rename existing table to legacy (preserve data)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = '_outbox' AND table_name = 'messages'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '_outbox' AND c.relname = 'messages' AND c.relkind = 'p'
  ) THEN
    ALTER TABLE _outbox.messages RENAME TO messages_legacy;
  END IF;
END $$;

-- Step 2: Create partitioned table (only if not already partitioned)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '_outbox' AND c.relname = 'messages' AND c.relkind = 'p'
  ) THEN
    EXECUTE '
      CREATE TABLE _outbox.messages (
        id             uuid         NOT NULL DEFAULT gen_random_uuid(),
        topic          varchar(128) NOT NULL,
        event_type     varchar(128) NOT NULL,
        tenant_id      uuid         NOT NULL,
        actor_id       uuid         NOT NULL,
        correlation_id varchar(64)  NOT NULL,
        payload        jsonb        NOT NULL,
        created_at     timestamptz  NOT NULL DEFAULT now(),
        published_at   timestamptz,
        PRIMARY KEY (id, created_at)
      ) PARTITION BY RANGE (created_at)
    ';
  END IF;
END $$;

-- Step 3: Create monthly partitions — current month + 3 months ahead
-- Partition naming: messages_yYYYYmMM
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
    part_name  := 'messages_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '_outbox' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE _outbox.%I PARTITION OF _outbox.messages
         FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    END IF;
  END LOOP;
END $$;

-- Step 4: Create a DEFAULT partition to catch rows outside defined ranges
CREATE TABLE IF NOT EXISTS _outbox.messages_default
  PARTITION OF _outbox.messages DEFAULT;

-- Step 5: Migrate legacy data into partitioned table (if legacy exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = '_outbox' AND table_name = 'messages_legacy'
  ) THEN
    INSERT INTO _outbox.messages (
      id, topic, event_type, tenant_id, actor_id,
      correlation_id, payload, created_at, published_at
    )
    SELECT
      id, topic, event_type, tenant_id, actor_id,
      correlation_id, payload, created_at, published_at
    FROM _outbox.messages_legacy
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Step 6: Recreate indexes on the partitioned table
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages(created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_tenant_created
  ON _outbox.messages(tenant_id, created_at);

-- Step 7: Re-enable RLS on the partitioned table (partitioning via rename loses
-- policies attached to the old relation, so tenant isolation must be re-applied).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = '_outbox' AND table_name = 'messages'
  ) THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      FOR ALL
      USING (tenant_id = scheme.current_tenant_id())
      WITH CHECK (tenant_id = scheme.current_tenant_id())';
  END IF;
END $$;

-- Step 8: Helper function to auto-create partitions 3 months ahead
-- Call this monthly (e.g., via pg_cron or application scheduler).
CREATE OR REPLACE FUNCTION _outbox.create_future_partitions()
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
    part_name  := 'messages_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '_outbox' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE _outbox.%I PARTITION OF _outbox.messages
         FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    END IF;
  END LOOP;
END $$;

-- Step 9: Drop legacy table after successful migration (guarded)
-- Uncomment after verifying data migrated correctly in production:
-- DROP TABLE IF EXISTS _outbox.messages_legacy;
