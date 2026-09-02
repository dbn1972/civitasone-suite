-- Purpose: restore the 5 CERT-In audit-field columns to events.events
--   (ip_address, user_agent, old_value, new_value, retain_until).
--
--   Root cause: migration 0004_cert_in_audit_fields.sql added these columns
--   via ALTER TABLE ADD COLUMN. Migration 0014_partition_audit_events.sql
--   later converted events.events to declarative partitioning by renaming
--   the original table to events_legacy and creating a brand-new
--   events.events via `CREATE TABLE events.events (...)` with an EXPLICIT,
--   HARDCODED column list — one that predates 0004 and so omits all 5 of
--   these columns. The data (and the columns) survived on events_legacy,
--   but the live events.events table silently lost them.
--
--   This is the exact same bug class that 0019_events_version_column.sql
--   already found and fixed for the `version` column (see that migration's
--   comment for the 0004-then-0014 gap pattern) — 0019 only patched
--   `version` and missed these other 5 CERT-In columns, which this
--   migration now restores.
--
--   Impact before this fix: modules/events/schema.ts (Drizzle) declares
--   ipAddress/userAgent/oldValue/newValue/retainUntil, and Drizzle builds
--   its column list from the schema, not by introspecting the live table —
--   so ANY query against auditEvents (tx.select().from(auditEvents), the
--   GET /v1/audit/events route, the export consumer's row-projection step,
--   etc.) threw `column "ip_address" does not exist` (or user_agent /
--   old_value / new_value / retain_until, depending on column order),
--   surfacing as 500s and, in the export consumer, as export rows silently
--   marked "failed" instead of "completed".
--
--   Types/defaults/nullability below match 0004's original declarations,
--   cross-checked against schema.ts's current Drizzle types, with two
--   deliberate reconciliations where the two disagree:
--
--   1. ip_address: 0004 declared `inet`; schema.ts declares
--      `varchar("ip_address", { length: 45 })` (schema.ts imports `inet`
--      from drizzle-orm/pg-core but does not use it for this column).
--      events/routes.ts passes the raw `x-forwarded-for` header straight
--      through as ipAddress with no parsing — X-Forwarded-For is commonly a
--      comma-separated hop list ("203.0.113.1, 70.41.3.18"), which is not
--      valid `inet` input and would reject on insert. Using varchar(45)
--      here (matching schema.ts and the actual data shape the app writes)
--      is correct; `inet` would break real proxied traffic.
--
--   2. retain_until: 0004 declared `NOT NULL DEFAULT (now() + INTERVAL
--      '180 days')`; schema.ts declares it nullable with no default. Every
--      insert path (events/consumer.ts, events/repo.ts) always computes and
--      supplies retainUntil explicitly — never relies on a DB default and
--      never passes null — so restoring the original NOT NULL DEFAULT is
--      safe (no existing insert breaks) and preserves the CERT-In §4
--      compliance guarantee documented in 0004 ("every event must be
--      retained for at least 180 days"): a future insert path that forgets
--      to set retainUntil now fails loudly instead of silently writing a
--      non-compliant NULL row. schema.ts's lack of `.notNull()` is treated
--      as ORM-side laxity, not an intentional relaxation of the DB
--      constraint.
--
--   user_agent (varchar(512)), old_value (jsonb), and new_value (jsonb)
--   agree between 0004 and schema.ts with no reconciliation needed.
--
--   Partition safety: events.events is a declaratively partitioned table
--   (RANGE on created_at, per 0014). ALTER TABLE ADD COLUMN on a
--   partitioned parent is applied atomically to the parent AND cascades to
--   every existing partition automatically — Postgres requires partitions
--   to share the parent's exact column set, so this is not optional
--   behavior needing a per-partition loop (0019 relied on the same single-
--   ALTER-on-parent behavior for `version`). Any partition created later by
--   events.create_future_partitions() (`CREATE TABLE ... PARTITION OF
--   events.events`) inherits the parent's full column set, including these
--   5, at creation time — no further action needed for future partitions.
--
--   events_legacy: this table predates 0014's partitioning migration and is
--   a rename of the ORIGINAL events.events table -- i.e. it already had
--   0004 applied via ALTER TABLE before it was renamed, so it should already
--   carry all 5 columns. The defensive ADD COLUMN IF NOT EXISTS below
--   (mirroring 0019's treatment of events_legacy for `version`) is a no-op
--   in the expected case and only guards against a deployment where
--   events_legacy was somehow created without them.
--
-- Rollback: ALTER TABLE events.events DROP COLUMN ip_address, DROP COLUMN
--   user_agent, DROP COLUMN old_value, DROP COLUMN new_value, DROP COLUMN
--   retain_until; (cascades to partitions). Also drop from events_legacy if
--   this migration's defensive branch actually added them there.
-- Affected services: audit-service

SET lock_timeout = '5s';

ALTER TABLE events.events
  ADD COLUMN IF NOT EXISTS ip_address    varchar(45),
  ADD COLUMN IF NOT EXISTS user_agent    varchar(512),
  ADD COLUMN IF NOT EXISTS old_value     jsonb,
  ADD COLUMN IF NOT EXISTS new_value     jsonb,
  ADD COLUMN IF NOT EXISTS retain_until  timestamptz NOT NULL
    DEFAULT (now() + INTERVAL '180 days');

-- Backfill retain_until for any existing rows in the partitioned table that
-- pre-date this migration (mirrors 0004's original backfill; a fresh
-- ADD COLUMN ... NOT NULL DEFAULT already backfills existing rows via the
-- DEFAULT, but this UPDATE is kept for defense-in-depth / documentation
-- parity with 0004, and is a no-op once the DEFAULT has already applied).
UPDATE events.events
   SET retain_until = occurred_at + INTERVAL '180 days'
 WHERE retain_until IS NULL;

-- events.events_legacy predates the 0014 partitioning migration and is a
-- rename of the ORIGINAL events.events table, so it already carries all 5
-- columns (with retain_until already NOT NULL DEFAULT-backfilled) from
-- 0004, applied before the 0014 rename -- confirmed empirically against a
-- fresh bootstrap (ADD COLUMN IF NOT EXISTS reported all 5 as already
-- present). Only a defensive ADD COLUMN IF NOT EXISTS is included here
-- (same pattern 0019 used for `version`), with no UPDATE/backfill or
-- ALTER COLUMN SET NOT NULL/DEFAULT step: events_legacy is an append-only
-- CERT-In audit table and audit_svc has UPDATE/DELETE revoked on it (same
-- as events.events, per 0004's immutability note), so any DML against it
-- here would fail with `permission denied for table events_legacy` -- and
-- is unneeded anyway since the column already has correct data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'events' AND table_name = 'events_legacy'
  ) THEN
    EXECUTE 'ALTER TABLE events.events_legacy
      ADD COLUMN IF NOT EXISTS ip_address    varchar(45),
      ADD COLUMN IF NOT EXISTS user_agent    varchar(512),
      ADD COLUMN IF NOT EXISTS old_value     jsonb,
      ADD COLUMN IF NOT EXISTS new_value     jsonb,
      ADD COLUMN IF NOT EXISTS retain_until  timestamptz NOT NULL
        DEFAULT (now() + INTERVAL ''180 days'')';
  END IF;
END $$;

-- Recreate the retention-sweep index in case this environment never ran
-- 0004 against events.events directly (e.g. a fresh bootstrap that only
-- replays migrations in order still gets this from 0004 first; this is
-- belt-and-braces for the partitioned table, matching 0004's original).
CREATE INDEX IF NOT EXISTS idx_audit_events_retain_until
  ON events.events(retain_until);
