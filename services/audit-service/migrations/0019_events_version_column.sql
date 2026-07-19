-- Purpose: add the `version` column to events.events (the append-only audit
--   event ledger). The Drizzle schema (modules/events/schema.ts) declares
--   `version: integer("version").notNull().default(1)` but no prior
--   migration ever added this column to the actual table — migration 0004
--   (cert_in_audit_fields) added ip_address/user_agent/old_value/new_value/
--   retain_until but not version, and migration 0014
--   (partition_audit_events) recreated the table via
--   `CREATE TABLE events.events (...)` with an explicit column list that
--   also omits version.
--
--   Root cause this fixes: ANY `SELECT *`-shaped Drizzle query against this
--   table (e.g. events/repo.ts's `listEvents`, `findById`,
--   `findLatestForTenant` — all `tx.select().from(auditEvents)`) throws
--   `column "version" does not exist`, since Drizzle generates the column
--   list from the schema definition, not by introspecting the live table.
--   This silently failed every audit-event read path, including the export
--   consumer's row-projection step (exports/consumer.ts), which caught the
--   error and marked the export "failed" instead of "completed" — surfacing
--   as an unrelated-looking export/signing test failure.
--
--   version is not currently used for optimistic locking on this table (it
--   is genuinely append-only — no UPDATE path exists, enforced by the
--   trg_events_immutable trigger from migration 0006/0011), so this column
--   only needs to exist and default correctly; no backfill logic beyond the
--   column default is required.
--
-- Rollback: ALTER TABLE events.events DROP COLUMN version; (also drop from
--   each existing partition if a version-specific rollback is required,
--   though DROP COLUMN on the parent table cascades to partitions).
-- Affected services: audit-service

SET lock_timeout = '5s';

ALTER TABLE events.events
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- events.events_legacy predates the 0014 partitioning migration and may
-- still be queried directly by historical-data tooling; keep its shape
-- consistent with the current schema for any code path that still touches it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'events' AND table_name = 'events_legacy'
  ) THEN
    EXECUTE 'ALTER TABLE events.events_legacy ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1';
  END IF;
END $$;
