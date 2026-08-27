-- revenue-service: make the outbox/inbox durable + fix outbox_relay_cycle_failed
-- Role: revenue_svc on civitas_revenue
-- Applied AFTER 0003_analytics_forecast_runs.sql
--
-- PART A — durability (async-infra fleet-stitching fix)
-- revenue-service's _outbox.messages was created (0001_init.sql) using the OLD
-- `published boolean` outbox convention. The CURRENT shared contract
-- (packages/outbox/src/index.ts) is `published_at timestamptz`, polled via
-- `WHERE published_at IS NULL`, plus an `_inbox.processed` table for
-- markProcessed() idempotency. Neither existed here, so revenue-worker was
-- hand-patched live (ALTER TABLE ... ADD COLUMN published_at; CREATE TABLE
-- _inbox.processed) to stop it crashing on boot. That live edit was never
-- captured as a migration and revenue-service was missing from
-- scripts/dev/migrate-all.mjs's SERVICES list, so a DB rebuild would silently
-- lose it. This migration reproduces the hotfix idempotently.
--
-- PART B — outbox_relay_cycle_failed (Postgres 42704) root-cause fix
-- rates.current_tenant_id() calls current_setting('app.tenant_id', false) —
-- missing_ok=false — so it RAISES instead of returning NULL when no GUC is
-- set. packages/outbox's startRelay/relayOnce is deliberately tenant-agnostic:
-- it polls ALL unpublished rows across every tenant in one query and never
-- sets app.tenant_id. Every relay cycle for revenue_svc (NOBYPASSRLS) was
-- therefore throwing 42704 against _outbox.messages' FORCE RLS policy
-- `USING (tenant_id = rates.current_tenant_id())`. The identical error hits
-- asset-service's depreciation scheduler for the same reason.
--
-- Investigated every service in the fleet with a live outbox to find the
-- pattern that actually works, not just the one that doesn't crash:
--   - asset-service / knowledge-service made current_tenant_id() NULL-safe
--     (NULLIF(current_setting('app.tenant_id', true), '')::uuid) but LEFT
--     FORCE RLS enabled on _outbox.messages. That silences the crash but does
--     NOT fix delivery: verified live against civitas_knowledge, the relay
--     now runs error-free yet 1450/1450 outbox rows are STILL unpublished,
--     because "tenant_id = NULL" is never true under RLS, so the
--     tenant-agnostic relay (a non-owner, NOBYPASSRLS role) sees ZERO rows
--     every cycle. Silent, total, permanent outbox stall — worse than the
--     crash, because nothing alerts on it.
--   - inspection-service never puts RLS on _outbox.messages at all. Verified
--     live against civitas_inspection: 165 total / 63 unpublished rows, i.e.
--     genuinely mixed published/unpublished — proof its relay is actively
--     publishing over time. This is the only pattern in the fleet that
--     demonstrably delivers.
--
-- DECISION: match inspection-service's demonstrably-working pattern.
-- _outbox.messages is an internal system relay table — no API/user ever
-- queries it directly. The tenant boundary that actually matters is enforced
-- twice already: once when the business write + outbox row are inserted in
-- the SAME transaction (under the business table's own FORCE RLS), and again
-- when the consumer processes the delivered event under runWithTenant(...).
-- Row-level tenant filtering on the outbox table itself only serves to block
-- the one process (the relay) that must legitimately see every tenant's
-- rows in one poll, so RLS is removed here — ONLY on _outbox.messages; every
-- other revenue table (rates.*, assessee.*, billing.*, ...) keeps FORCE RLS
-- untouched. rates.current_tenant_id() is also made NULL-safe as defense in
-- depth (it remains enforced everywhere else) so any future accidental
-- cross-tenant call fails closed (zero rows) instead of crashing the caller.
--
-- Rollback:
--   ALTER TABLE _outbox.messages DROP COLUMN published_at;
--   DROP TABLE _inbox.processed; DROP SCHEMA _inbox;
--   ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = rates.current_tenant_id());
--   (current_tenant_id() strict-mode rollback intentionally not provided — NULL-safe is strictly safer)

SET lock_timeout = '5s';

-- ── Part B: NULL-safe tenant helper + drop RLS on the relay table only ───────
-- Moved AHEAD of Part A (was originally last in this file): Part A's backfill
-- UPDATE below touches _outbox.messages, which until this point in the
-- migration sequence still carries the FORCE RLS policy from
-- 0002_rls_tenant_isolation.sql (`tenant_id = rates.current_tenant_id()`) using
-- the OLD strict-mode current_tenant_id() (current_setting('app.tenant_id',
-- false), which raises instead of returning NULL). With Part B still running
-- after Part A, evaluating that pre-existing policy for the UPDATE's row scan
-- invoked the not-yet-replaced strict function and raised "unrecognized
-- configuration parameter app.tenant_id" (42704) — this migration's own fix
-- existed but took effect one statement too late. Running Part B first means
-- RLS is already disabled on _outbox.messages (and the helper already
-- NULL-safe, as defense in depth) before anything in Part A touches the table.

CREATE OR REPLACE FUNCTION rates.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
ALTER TABLE _outbox.messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages DISABLE ROW LEVEL SECURITY;

-- ── Part A: durable _inbox.processed + _outbox.messages.published_at ─────────

CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE _outbox.messages ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Backfill published_at for rows already marked published under the legacy
-- `published boolean` convention, so the new relay (which polls
-- WHERE published_at IS NULL) does not re-publish events that were already
-- delivered under the old convention.
UPDATE _outbox.messages
SET published_at = created_at
WHERE published_at IS NULL AND published = true;

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished_at
  ON _outbox.messages(created_at) WHERE published_at IS NULL;

GRANT USAGE ON SCHEMA _inbox TO revenue_svc;
GRANT SELECT, INSERT, DELETE ON _inbox.processed TO revenue_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO revenue_svc;
