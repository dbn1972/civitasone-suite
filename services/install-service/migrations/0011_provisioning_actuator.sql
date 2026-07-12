-- Purpose: Support the automated Provisioning_Actuator's resumable migration
--   apply loop by giving install.silo_provisions durable, per-record state for
--   (a) which migration files have been confirmed applied so far, so a resumed
--   run after a `failed` status can diff against this and skip already-applied
--   steps instead of re-running the whole fleet migration walk, and (b) when
--   the current provisioning attempt's runner started, so a worker poll loop
--   can detect a stale `provisioning` record (crashed runner) and safely
--   re-claim it.
-- Rollback: ALTER TABLE install.silo_provisions DROP COLUMN IF EXISTS applied_migrations;
--           ALTER TABLE install.silo_provisions DROP COLUMN IF EXISTS runner_started_at;
-- Affected services: install-service only.
-- Safety: IF NOT EXISTS ensures idempotency. SET lock_timeout = '5s' avoids
--   blocking production queries if the ALTER TABLE contends with a long-running
--   transaction. Both columns are additive (new column, default or nullable) —
--   no backfill or NOT NULL required, so this is safe for a table of any size.

SET lock_timeout = '5s';

ALTER TABLE install.silo_provisions
  ADD COLUMN IF NOT EXISTS applied_migrations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE install.silo_provisions
  ADD COLUMN IF NOT EXISTS runner_started_at TIMESTAMPTZ;
